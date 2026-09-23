import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildSauna } from './geometry/index.js';

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

    // 36 deg is a flattering near-telephoto for the exterior, but standing
    // inside a 2 m cabin with it shows barely one object - interiors get a
    // wide angle, the way interior photography actually works.
    this.fovExterior = 36; this.fovInterior = 62;
    this.camera = new THREE.PerspectiveCamera(this.fovExterior, 1, 0.02, 80);
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
    this.hemi = new THREE.HemisphereLight(0xfff8f0, 0x7a8c70, 1.1);
    this.scene.add(this.hemi);

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

    // The key/fill/rim rig above is set up for the exterior hero shot. Left at
    // full strength it blows out an interior: pale aspen benches a metre from
    // the lens under a 2.8-intensity sun clip to flat white. Interiors dim the
    // outdoor rig right down so the cabin's own lamps and LEDs carry the shot.
    this.lightRig = [
      [this.hemi, 1.1, 0.34], [this.sun, 2.8, 0.42],
      [this.fill, 0.55, 0.30], [this.rim, 0.30, 0.12],
    ];
    this.exposure = { exterior: 1.18, interior: 0.95 };

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

  setConfig(cfg, catalog, lang = 'en') {
    for (const obj of this.model.children.slice()) this.model.remove(obj);
    this.disposeGroup(this.lastGroup);
    const built = buildSauna(cfg, catalog, this.materials, lang);
    this.lastGroup = built.group;
    this.model.add(built.group);
    this.registry = built.registry;
    this.doorSign = built.doorSign;
    this.bounds = built.bounds;
    this.heaterInfo = built.heaterInfo;
    this.interiorView = built.interiorView || null;

    // Attach the new doorRoot and capture its rest rotation immediately,
    // before any applyDoor() call can overwrite it.
    this.doorRoot = built.doorRoot;
    if (this.doorRoot) {
      this.doorRoot.userData.baseRotY = this.doorRoot.rotation.y;
    }

    this.frame(built.bounds);
    if (typeof window !== 'undefined') {
      // cfg/family are exposed so harnesses can test against the REAL footprint.
      // Deriving W/D from the registry bounding box instead silently picks up
      // the roof overhang and validates against a footprint that is too large.
      window.__saunaDebug = { bounds: built.bounds, cameraPos: this.camera.position.toArray(), target: this.controls.target.toArray(), size: this.size, centre: this.centre?.toArray(), registryCount: this.registry.length, fov: this.camera.fov, aspect: this.camera.aspect, hostSize: [this.host.clientWidth, this.host.clientHeight], registry: this.registry, THREE_DEBUG: THREE, camera: this.camera, renderer: this.renderer, scene: this.scene, controls: this.controls, cfg, family: catalog?.families?.[cfg?.family] };
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
    this.applyLighting(view);
    if (!this.centre || !this.bounds) return;
    const size = this.size || 1.6;
    const H = this.bounds.maxY - this.bounds.minY;
    // Exterior: look at the cabin's lower-mid body (not its geometric centre,
    // which sits at half height) from well above roof level, so the roof and
    // all four walls read clearly - the same framing the Blender renders use.
    const exteriorLook = new THREE.Vector3(this.centre.x, H * 0.32, this.centre.z);
    // Interior: stand just inside the entrance at eye height, looking toward
    // the back wall so the benches and heater read clearly. Rectangular
    // cabins use this generic entrance-at-+Z formula; shapes whose door isn't
    // on a +Z wall (barrel, round) supply their own interiorView instead.
    const interiorLook = this.interiorView?.look || new THREE.Vector3(this.centre.x, 1.45, this.bounds.minZ + size * 0.15);
    const interiorPos = this.interiorView?.pos || new THREE.Vector3(this.centre.x + size * 0.14, 1.5, this.bounds.maxZ - size * 0.16);
    const targets = {
      exterior: { pos: this.orbitPosition(exteriorLook, size, 34, 30, 2.5), look: exteriorLook, fov: this.fovExterior },
      interior: { pos: interiorPos, look: interiorLook, fov: this.fovInterior },
    };
    const t = targets[view] || targets.exterior;
    this.doorTarget = view === 'interior' ? 1 : 0;
    if (instant) {
      this.camera.position.copy(t.pos);
      this.controls.target.copy(t.look);
      this.camera.fov = t.fov;
      this.camera.updateProjectionMatrix();
      this.controls.update();
    } else {
      this.animateTo(t.pos, t.look, 900, t.fov);
    }
  }

  /** Swap the outdoor light rig between exterior strength and interior strength. */
  applyLighting(view) {
    if (!this.lightRig) return;
    const inside = view === 'interior';
    for (const [light, ext, int] of this.lightRig) if (light) light.intensity = inside ? int : ext;
    this.renderer.toneMappingExposure = inside ? this.exposure.interior : this.exposure.exterior;
  }

  animateTo(pos, look, durationMs = 900, fov = this.camera.fov) {
    this.anim = { from: this.camera.position.clone(), to: pos.clone(), fromLook: this.controls.target.clone(), toLook: look.clone(), fromFov: this.camera.fov, toFov: fov, t: 0, durationMs, start: performance.now() };
  }

  /**
   * Render exterior, top and side views into PNG data URLs for the PDF quote,
   * without disturbing whatever the customer is currently looking at (camera,
   * orbit target and door state are all restored afterwards).
   */
  captureViews() {
    if (!this.centre || !this.bounds) return null;
    const savedPos = this.camera.position.clone();
    const savedTarget = this.controls.target.clone();
    const savedAnim = this.anim;
    const savedDoorT = this.doorOpenT;
    this.anim = null;

    const size = this.size || 1.6;
    const H = this.bounds.maxY - this.bounds.minY;
    const exteriorLook = new THREE.Vector3(this.centre.x, H * 0.32, this.centre.z);
    const shots = {
      exterior: { pos: this.orbitPosition(exteriorLook, size, 34, 30, 2.5), look: exteriorLook },
      top: { pos: this.orbitPosition(exteriorLook, size, 20, 87, 2.8), look: exteriorLook },
      side: { pos: this.orbitPosition(exteriorLook, size, 90, 14, 2.6), look: exteriorLook },
    };

    this.doorOpenT = 0;
    this.applyDoor();
    const out = {};
    for (const [name, t] of Object.entries(shots)) {
      this.camera.position.copy(t.pos);
      this.controls.target.copy(t.look);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      out[name] = this.renderer.domElement.toDataURL('image/png');
    }

    this.camera.position.copy(savedPos);
    this.controls.target.copy(savedTarget);
    this.controls.update();
    this.doorOpenT = savedDoorT;
    this.applyDoor();
    this.anim = savedAnim;
    this.renderer.render(this.scene, this.camera);
    return out;
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
    if (this.anim) {
      // Time-based, not frame-count-based: a fixed per-frame increment would
      // make this transition take several seconds on a slow/throttled device
      // instead of the intended well-under-a-second camera move.
      this.anim.t = Math.min(1, (performance.now() - this.anim.start) / this.anim.durationMs);
      const e = 1 - Math.pow(1 - this.anim.t, 3);
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
      this.controls.target.lerpVectors(this.anim.fromLook, this.anim.toLook, e);
      if (this.anim.toFov !== this.anim.fromFov) {
        this.camera.fov = this.anim.fromFov + (this.anim.toFov - this.anim.fromFov) * e;
        this.camera.updateProjectionMatrix();
      }
      if (this.anim.t >= 1) this.anim = null;
    }
    // controls.update() re-orients the camera to face controls.target and is
    // needed every frame, including mid-animation - it's what keeps the
    // camera actually looking at the target as both move during the lerp
    // above, not just OrbitControls' own user-drag damping.
    this.controls.update();
    if (Math.abs(this.doorOpenT - this.doorTarget) > 0.002) {
      this.doorOpenT += (this.doorTarget - this.doorOpenT) * 0.12;
      this.applyDoor();
    }
    if (this.pointerMoved) { this.pick(); this.pointerMoved = false; }
    this.renderer.render(this.scene, this.camera);
  }

  async exportGLB(filename = 'custom-sauna') {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    this.model.updateMatrixWorld(true);
    const gltf = await exporter.parseAsync(this.model, { binary: true });
    const blob = new Blob([gltf], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.glb`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
