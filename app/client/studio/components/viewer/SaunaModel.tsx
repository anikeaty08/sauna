import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStudio } from '../../store/configurationStore.ts';
import { ModuleAssembler } from '../../features/sauna/assembly/ModuleAssembler.ts';
import { dirtyGroups } from '../../../../../packages/configuration-core/index.ts';

/**
 * Renders the assembled sauna. The assembler owns the scene graph; this
 * component only feeds it engine results (in order) and animates the door.
 * Nothing is reloaded on a change - only dirty module groups are rebuilt.
 */
export function SaunaModel({ onStatus }: { onStatus: (s: { loading: boolean; error: string | null }) => void }) {
  const invalidate = useThree(st => st.invalidate);
  const assembler = useMemo(() => new ModuleAssembler(), []);
  useEffect(() => { assembler.materials.onChange = () => invalidate(); }, [assembler, invalidate]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const layout = useStudio(s => s.layout);
  const doorOpen = useStudio(s => s.doorOpen);
  const doorAngle = useRef(0);

  useEffect(() => () => assembler.dispose(), [assembler]);

  // The first build is always complete: the store's `dirty` only lists what the
  // last change touched, and a design loaded before this view mounted (AR page,
  // shared links) would otherwise build just those groups - no walls or glass.
  const built = useRef(false);
  useEffect(() => {
    const { config } = useStudio.getState();
    const dirty = built.current ? useStudio.getState().dirty : dirtyGroups(null, config);
    built.current = true;
    onStatus({ loading: true, error: null });
    queue.current = queue.current
      .then(() => assembler.update(config, layout, dirty))
      .then(() => { onStatus({ loading: false, error: null }); invalidate(); })
      .catch((e: Error) => onStatus({ loading: false, error: e.message || 'The 3D modules could not be loaded.' }));
  }, [assembler, layout, onStatus, invalidate]);

  useEffect(() => { invalidate(); }, [doorOpen, invalidate]);

  // The glass door swings outward when the customer opens it.
  useFrame((_, dt) => {
    const pivot = assembler.doorPivot;
    if (!pivot) return;
    if (!pivot.userData.base) pivot.userData.base = pivot.quaternion.clone();
    const target = doorOpen ? THREE.MathUtils.degToRad(80) : 0;
    if (Math.abs(doorAngle.current - target) < 1e-4) return;
    doorAngle.current = Math.abs(doorAngle.current - target) < 0.002 ? target : THREE.MathUtils.damp(doorAngle.current, target, 6, Math.min(dt, 0.05));
    invalidate();
    pivot.quaternion.copy(pivot.userData.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), assembler.doorOpenSign * doorAngle.current));
  });

  return <primitive object={assembler.root} />;
}
