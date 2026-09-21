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
    // Warm studio gradient background (approximated with a solid warm neutral)
    this.scene.background = new THREE.Color('#d8e0d4');
    // Subtle warm fog for depth
    this.scene.fog = new THREE.FogExp2(0xdde5da, 0.018);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.02, 80);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Slightly warmer exposure for a premium feel
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D sauna. Drag to orbit, scroll to zoom, click a part to configure it.');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1, 1);

    // Premium environment using RoomEnvironment
    const env = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(env, 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.75;
    env.dispose(); pmrem.dispose();

    // Warm hemisphere (sky warm, ground earthy)
    this.scene.add(new THREE.HemisphereLight(0xfff8f0, 0x7a8c70, 1.1));

    // Key light — warm afternoon sun
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    // Soft fill light from the front-left (reduces harsh shadow depth)
    this.fill = new THREE.DirectionalLight(0xe8f0ff, 0.55);
    this.scene.add(this.fill);

    // Subtle rim light from behind for depth separation
    this.rim = new THREE.DirectionalLight(0xfff8e8, 0.30);
    this.scene.add(this.rim);

    // Reflective floor with subtle shadow
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity: 0.12, color: 0x3a5040 }),
    );
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
    // Second resize after the browser has painted the layout — ensures the
    // host div has real pixel dimensions before we set the camera aspect ratio.
    setTimeout(() => this.resize(), 0);
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
    this.doorSign = built.doorSign;
    this.bounds = built.bounds;
    this.heaterInfo = built.heaterInfo;

    // Attach the new doorRoot and capture its rest rotation immediately,
    // before any applyDoor() call can overwrite it.
    this.doorRoot = built.doorRoot;
    if (this.doorRoot) {
      this.doorRoot.userData.baseRotY = this.doorRoot.rotation.y;
    }

    this.frame(built.bounds);
    if (typeof window !== 'undefined') {
      window.__saunaDebug = { bounds: built.bounds, cameraPos: this.camera.position.toArray(), target: this.controls.target.toArray(), size: this.size, centre: this.centre?.toArray(), registryCount: this.registry.length, fov: this.camera.fov, aspect: this.camera.aspect, hostSize: [this.host.clientWidth, this.host.clientHeight] };
    }

    // When first loading interior view, open door; otherwise preserve the
    // current door state (so toggling open then switching cabin size keeps it open).
    if (!this.framed) {
      this.doorOpenT = this.doorTarget = this.view === 'interior' ? 1 : 0;
    }
    this.applyDoor();
  }

  disposeGroup(group) {
    if (!group) return;
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
    });
  }

  frame(bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, bounds.maxY);
    this.centre = new THREE.Vector3(cx, bounds.maxY * 0.45, cz);
    this.size = size;
    this.floor.position.set(cx, -0.001, cz);

    // Key (sun) — upper-right, warm afternoon angle
    this.sun.position.set(cx + size * 1.7, size * 2.8, cz - size * 1.1);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.shadow.camera.left   = -size * 1.5;
    this.sun.shadow.camera.right  =  size * 1.5;
    this.sun.shadow.camera.top    =  size * 1.5;
    this.sun.shadow.camera.bottom = -size * 1.5;
    this.sun.shadow.camera.near   = 0.5;
    this.sun.shadow.camera.far    = size * 7;
    this.sun.shadow.camera.updateProjectionMatrix();

    // Fill — soft, front-left, lower
    this.fill.position.set(cx - size * 1.2, size * 1.0, cz + size * 1.8);

    // Rim — from behind, high
    this.rim.position.set(cx - size * 0.5, size * 2.0, cz - size * 2.0);

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
    // baseRotY is captured once in setConfig when the doorRoot is freshly built.
    // Guard here in case something calls applyDoor before setConfig ran.
    if (this.doorRoot.userData.baseRotY === undefined) {
      this.doorRoot.userData.baseRotY = this.doorRoot.rotation.y;
    }
    const angle = (this.doorOpenT * Math.PI) / 2; // 0 → closed, 1 → 90°
    this.doorRoot.rotation.y = this.doorRoot.userData.baseRotY - this.doorSign * angle;
  }

  setDoorOpen(open) {
    this.doorTarget = open ? 1 : 0;
  }

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
