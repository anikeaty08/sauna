import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildSauna } from './geometry.js';

/**
 * Owns the renderer/scene/camera for the live customizer: rebuilds the
 * parametric model on every config change, frames the camera on the new
 * bounds, and raycasts for hover/click so the UI can show a price tooltip
 * or open a component's options.
 */
export class SaunaScene {
  constructor(host, materials, { onHover, onSelect } = {}) {
    this.host = host;
    this.materials = materials;
    this.onHover = onHover || (() => {});
    this.onSelect = onSelect || (() => {});
    this.view = 'exterior';
    this.doorOpenT = 0; // 0..1
    this.doorTarget = 0;
    this.disposed = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e7ebe4');
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D sauna. Drag to orbit, scroll to zoom, click a part to configure it.');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 1, 1);

    const env = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(env, 0.045).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.6;
    env.dispose(); pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x859079, 1.3));
    this.sun = new THREE.DirectionalLight(0xfff3e2, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun, this.sun.target);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.15 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.registry = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-2, -2);
    this.hovered = null;
    this.pointerMoved = false;

    this.onPointerMove = event => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.lastClientX = event.clientX; this.lastClientY = event.clientY;
      this.pointerMoved = true;
    };
    this.onPointerLeave = () => { this.pointer.set(-2, -2); this.pointerMoved = true; };
    this.onPointerDown = event => { this.downXY = [event.clientX, event.clientY]; };
    this.onPointerUp = event => {
      if (!this.downXY) return;
      const dx = event.clientX - this.downXY[0], dy = event.clientY - this.downXY[1];
      if (Math.hypot(dx, dy) > 6) return; // drag, not a click
      this.pick(event, true);
    };
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setConfig(cfg, catalog) {
    for (const obj of this.model.children.slice()) this.model.remove(obj);
    this.disposeGroup(this.lastGroup);
    const built = buildSauna(cfg, catalog, this.materials);
    this.lastGroup = built.group;
    this.model.add(built.group);
    this.registry = built.registry;
    this.doorRoot = built.doorRoot;
    this.doorSign = built.doorSign;
    this.bounds = built.bounds;
    this.heaterInfo = built.heaterInfo;
    this.frame(built.bounds);
    if (typeof window !== 'undefined') {
      window.__saunaDebug = { bounds: built.bounds, cameraPos: this.camera.position.toArray(), target: this.controls.target.toArray(), size: this.size, centre: this.centre?.toArray(), registryCount: this.registry.length, fov: this.camera.fov, aspect: this.camera.aspect, hostSize: [this.host.clientWidth, this.host.clientHeight] };
    }
    this.doorOpenT = this.doorTarget = this.view === 'interior' ? 1 : 0;
    this.applyDoor();
  }

  disposeGroup(group) {
    if (!group) return;
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
    });
  }

  frame(bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2, cy = bounds.maxY * 0.45;
    const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, bounds.maxY);
    this.centre = new THREE.Vector3(cx, cy, cz);
    this.size = size;
    this.floor.position.set(cx, -0.001, cz);
    this.sun.position.set(cx + size * 1.6, size * 2.6, cz - size * 1.2);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.shadow.camera.left = -size * 1.4; this.sun.shadow.camera.right = size * 1.4;
    this.sun.shadow.camera.top = size * 1.4; this.sun.shadow.camera.bottom = -size * 1.4;
    this.sun.shadow.camera.near = 0.5; this.sun.shadow.camera.far = size * 6;
    this.sun.shadow.camera.updateProjectionMatrix();
    if (!this.framed || Math.abs((this.lastSize || 0) - size) > 0.01) {
      this.setView(this.view, true);
      this.framed = true;
      this.lastSize = size;
    }
  }

  /** A camera position on a sphere around `look`, well clear of the cabin's own size. */
  orbitPosition(look, size, azimuthDeg, elevationDeg, distanceFactor) {
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const el = THREE.MathUtils.degToRad(elevationDeg);
    const r = size * distanceFactor;
    const horizontal = r * Math.cos(el);
    return new THREE.Vector3(look.x + horizontal * Math.sin(az), look.y + r * Math.sin(el), look.z + horizontal * Math.cos(az));
  }

  setView(view, instant = false) {
    this.view = view;
    if (!this.centre || !this.bounds) return;
    const size = this.size || 1.6;
    const H = this.bounds.maxY - this.bounds.minY;
    // Exterior: look at the cabin's lower-mid body (not its geometric centre,
    // which sits at half height) from well above roof level, so the roof and
    // all four walls read clearly - the same framing the Blender renders use.
    const exteriorLook = new THREE.Vector3(this.centre.x, H * 0.32, this.centre.z);
    // Interior: stand just inside the entrance (the +Z wall) at eye height,
    // looking toward the back wall so the benches and heater read clearly.
    const interiorLook = new THREE.Vector3(this.centre.x, 1.45, this.bounds.minZ + size * 0.15);
    const interiorPos = new THREE.Vector3(this.centre.x + size * 0.14, 1.5, this.bounds.maxZ - size * 0.16);
    const targets = {
      exterior: { pos: this.orbitPosition(exteriorLook, size, 34, 30, 2.5), look: exteriorLook },
      interior: { pos: interiorPos, look: interiorLook },
    };
    const t = targets[view] || targets.exterior;
    this.doorTarget = view === 'interior' ? 1 : 0;
    if (instant) {
      this.camera.position.copy(t.pos);
      this.controls.target.copy(t.look);
      this.controls.update();
    } else {
      this.animateTo(t.pos, t.look);
    }
  }

  animateTo(pos, look) {
    this.anim = { from: this.camera.position.clone(), to: pos.clone(), fromLook: this.controls.target.clone(), toLook: look.clone(), t: 0 };
  }

  applyDoor() {
    if (!this.doorRoot) return;
    const angle = (this.doorOpenT * 90 * Math.PI) / 180;
    this.doorRoot.rotation.y = this.doorRoot.userData.baseRotY ?? this.doorRoot.rotation.y;
    if (this.doorRoot.userData.baseRotY === undefined) this.doorRoot.userData.baseRotY = this.doorRoot.rotation.y;
    this.doorRoot.rotation.y = this.doorRoot.userData.baseRotY - this.doorSign * angle;
  }

  setDoorOpen(open) { this.doorTarget = open ? 1 : 0; }

  pick(event, isClick) {
    if (!this.registry.length) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.registry, false);
    const hit = hits[0]?.object || null;
    if (isClick) {
      this.onSelect(hit?.userData.info || null, event);
      return;
    }
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.onHover(hit?.userData.info || null, this.lastClientX, this.lastClientY);
    } else if (hit) {
      this.onHover(hit.userData.info, this.lastClientX, this.lastClientY);
    }
  }

  tick() {
    if (this.disposed) return;
    this.controls.update();
    if (this.anim) {
      this.anim.t = Math.min(1, this.anim.t + 0.045);
      const e = 1 - Math.pow(1 - this.anim.t, 3);
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
      this.controls.target.lerpVectors(this.anim.fromLook, this.anim.toLook, e);
      if (this.anim.t >= 1) this.anim = null;
    }
    if (Math.abs(this.doorOpenT - this.doorTarget) > 0.002) {
      this.doorOpenT += (this.doorTarget - this.doorOpenT) * 0.12;
      this.applyDoor();
    }
    if (this.pointerMoved) { this.pick(); this.pointerMoved = false; }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    this.disposeGroup(this.lastGroup);
    this.envTex?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
