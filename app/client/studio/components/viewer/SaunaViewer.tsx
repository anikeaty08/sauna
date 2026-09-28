import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { SaunaModel } from './SaunaModel.tsx';
import { CameraRig } from './CameraRig.tsx';
import { useStudio, SECTION_TAB } from '../../store/configurationStore.ts';

class ViewerBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) return <div className="st-viewer-msg">The 3D view could not start ({this.state.error}). Your configuration and price still work.</div>;
    return this.props.children;
  }
}

function Lighting() {
  const interior = useStudio(s => SECTION_TAB[s.section] === 'interior');
  const { gl, invalidate } = useThree();
  // Interiors are lit by the cabin's own warm lights, so they get more exposure.
  useEffect(() => { gl.toneMappingExposure = interior ? 1.4 : 1.05; invalidate(); }, [gl, interior, invalidate]);
  return (
    <>
      <hemisphereLight args={[interior ? 0xffe4c4 : 0xfff8ef, interior ? 0x8a6a4a : 0xb9b2a6, interior ? 0.55 : 0.9]} />
      <directionalLight position={[4, 7, -3]} intensity={interior ? 0.35 : 2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} shadow-normalBias={0.02} shadow-radius={4}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} />
      <directionalLight position={[-4, 3, 4]} intensity={interior ? 0.25 : 0.55} color={interior ? 0xffd9b0 : 0xffffff} />
      {/* Local studio environment for glass/metal reflections (no network fetch). */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={1} position={[6, 2, -4]} scale={[4, 3, 1]} />
        <Lightformer form="rect" intensity={0.6} position={[-6, 2, 4]} scale={[4, 3, 1]} />
      </Environment>
    </>
  );
}

/** The production 3D stage: canvas, lights, environment, camera rig, model. */
export function SaunaViewer({ onCanvas }: { onCanvas?: (canvas: HTMLCanvasElement) => void }) {
  const [status, setStatus] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const onStatus = useCallback((s: { loading: boolean; error: string | null }) => setStatus(s), []);
  return (
    <ViewerBoundary>
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 36, near: 0.02, far: 80, position: [6, 3, -5] }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onCreated={({ gl }) => onCanvas?.(gl.domElement)}
        aria-label="Interactive 3D sauna. Drag to orbit, scroll to zoom."
      >
        <color attach="background" args={['#f6f5f1']} />
        <fog attach="fog" args={['#f6f5f1', 14, 32]} />
        <Lighting />
        <SaunaModel onStatus={onStatus} />
        <ContactShadows position={[0, 0.001, 0]} opacity={0.35} scale={12} blur={2.4} far={3} />
        <CameraRig />
      </Canvas>
      {status.loading && <div className="st-viewer-msg is-soft">Loading sauna modules…</div>}
      {status.error && <div className="st-viewer-msg">{status.error}</div>}
    </ViewerBoundary>
  );
}
