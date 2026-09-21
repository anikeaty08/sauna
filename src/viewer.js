import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const findPart = (root, part) => {
  let found;
  root.traverse(object => { if (!found && object.userData.part === part) found = object; });
  return found;
};

export class SaunaViewer {
  constructor(host, { onStatus, onDoor, onXR }) {
    this.host = host;
    this.defaultHost = host;
    this.onStatus = onStatus;
    this.onDoor = onDoor;
    this.onXR = onXR;
    this.assets = new Map();
    this.pivots = new Map();
    this.config = { door: 'left', heater: 'integrated', angle: 0, wall: true, bench: true };
    this.view = 'exterior';
    this.component = 'all';
    this.disposed = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e7ebe4');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.025, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.transmissionResolutionScale = 0.5;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D sauna. Drag to orbit, scroll to zoom.');
    this.renderer.domElement.setAttribute('tabindex', '0');
    this.renderer.domElement.setAttribute('role', 'img');
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('start', () => { this.cameraMotion = null; });
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    this.stage.add(floor);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(environment, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.65;
    environment.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x859079, 1.4));
    const key = new THREE.DirectionalLight(0xfff6e8, 3.1);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -3;
    key.shadow.camera.right = key.shadow.camera.top = 3;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.01;
    this.scene.add(key);
    this.wallLight = new THREE.PointLight(0xffc17d, 0.8, 2.2, 2);
    this.wallLight.position.set(-0.46, 1.62, 0.23);
    this.benchLight = new THREE.PointLight(0xffb572, 0.32, 1.5, 2);
    this.benchLight.position.set(0, 0.78, 0.3);
    this.model.add(this.wallLight, this.benchLight);
    this.dimensionBox = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-0.7, 0, 0), new THREE.Vector3(0.7, 2.02, 1.2)), 0x638363);
    this.dimensionBox.visible = false;
    this.model.add(this.dimensionBox);
    this.draco = new DRACOLoader().setDecoderPath('/draco/');
    this.draco.setWorkerLimit(2);
    this.loader = new GLTFLoader().setDRACOLoader(this.draco);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.setView('exterior', true);
    this.pointerDown = event => { this.down = [event.clientX, event.clientY]; };
    this.pointerUp = event => this.pick(event);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.contextLost = event => { event.preventDefault(); this.onStatus({ error: 'The 3D view lost its connection. Reload to restore it.' }); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));
  }

  async load(catalog) {
    const started = performance.now();
    const results = await Promise.allSettled(catalog.assets.map(async (asset, index) => {
      const gltf = await this.loader.loadAsync(asset.url);
      if (this.disposed) { this.disposeObject(gltf.scene); return; }
      const root = gltf.scene;
      root.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const glass = materials.some(material => material.transmission > 0);
        object.castShadow = !glass;
        object.receiveShadow = true;
        for (const material of materials) {
          if (material.map) material.map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          if (material.transmission > 0) { material.thickness = 0.008; material.roughness = 0.025; }
        }
      });
      if (asset.id.startsWith('door_')) {
        let assembly;
        root.traverse(object => { if (object.userData.hinge_pivot_gltf) assembly = object; });
        const leaf = findPart(root, 'door_leaf');
        if (!assembly || !leaf) throw new Error('Door pivot metadata is missing.');
        const pivot = new THREE.Group();
        pivot.name = `${asset.id}_swing`;
        pivot.position.fromArray(assembly.userData.hinge_pivot_gltf);
        assembly.add(pivot);
        root.updateMatrixWorld(true);
        pivot.attach(leaf);
        pivot.userData.openSign = assembly.userData.open_sign;
        this.pivots.set(asset.id, pivot);
      }
      this.assets.set(asset.id, root);
      this.model.add(root);
      this.apply(this.config);
      this.onStatus({ progress: Math.round(this.assets.size / catalog.assets.length * 100) });
    }));
    if (this.disposed) return;
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error(`${failures.length} model part(s) could not load. Please try again.`);
    this.loadMs = performance.now() - started;
    this.setView('exterior', true);
    this.onStatus({ ready: true, loadMs: this.loadMs });
  }

  apply(config) {
    this.dirty = true;
    this.config = { ...config };
    for (const [id, asset] of this.assets) {
      let visible = id === 'base_cabin' || id === `door_${config.door}-hinge` || id === `heater_${config.heater}-control` ||
        (id === 'lighting_timber-shade' && config.wall) || (id === 'lighting_under-bench' && config.bench);
      if (this.component !== 'all') {
        visible = this.component === 'cabin' ? id === 'base_cabin' : this.component === 'door' ? id === `door_${config.door}-hinge` :
          this.component === 'heater' ? id === `heater_${config.heater}-control` : this.component === 'lighting' ? id.startsWith('lighting_') : id === 'scale_reference';
      }
      asset.visible = visible;
    }
    this.wallLight.visible = config.wall && this.component === 'all';
    this.benchLight.visible = config.bench && this.component === 'all';
    const cabin = this.assets.get('base_cabin');
    if (cabin) {
      for (const part of ['roof', 'right']) {
        const object = findPart(cabin, part);
        if (object) object.visible = this.view !== 'cutaway';
      }
    }
    if (this.reducedMotion) this.animateDoor(1);
  }

  animateDoor(alpha) {
    for (const [id, pivot] of this.pivots) {
      pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, this.targetDoorAngle(id, pivot), alpha);
    }
  }

  targetDoorAngle(id, pivot) {
    const isSelectedDoor = id === `door_${this.config.door}-hinge`;
    return THREE.MathUtils.degToRad((isSelectedDoor ? this.config.angle : 0) * pivot.userData.openSign);
  }

  setComponent(component) { this.component = component; this.view = 'exterior'; this.apply(this.config); this.setView('exterior'); }

  setView(view, immediate = false) {
    this.view = view;
    this.apply(this.config);
    let position, target, fov = 35;
    if (this.component !== 'all' && this.assets.size) {
      const box = new THREE.Box3();
      for (const asset of this.assets.values()) if (asset.visible) box.expandByObject(asset);
      target = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z) * 2.1;
      position = target.clone().add(new THREE.Vector3(distance * 0.55, distance * 0.4, distance));
    } else if (view === 'interior') {
      position = new THREE.Vector3(-0.20, 1.42, 1.10);
      target = new THREE.Vector3(0, 1.04, 0.22);
      fov = 88;
    } else {
      const mobile = this.host.clientWidth < 600;
      position = view === 'cutaway' ? new THREE.Vector3(3.05, 3.55, 4.6) : new THREE.Vector3(3.35, 2.7, 5.3);
      target = new THREE.Vector3(0, 0.98, 0.6);
      if (mobile) { position.sub(target).multiplyScalar(1.14).add(target); target.y = 1.08; }
    }
    this.controls.maxPolarAngle = view === 'interior' ? Math.PI : Math.PI * 0.495;
    this.controls.minDistance = view === 'interior' ? 0.15 : 0.5;
    if (immediate || this.reducedMotion) { this.camera.position.copy(position); this.controls.target.copy(target); this.camera.fov = fov; this.camera.updateProjectionMatrix(); this.controls.update(); }
    else this.cameraMotion = { position, target, fov };
  }

  resize() {
    this.dirty = true;
    if (this.renderer.xr.isPresenting) return;
    const { clientWidth: width, clientHeight: height } = this.host;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
  }

  // Move the live canvas into another container, so a camera preview can show the real
  // model over a video feed rather than a flat snapshot. Sizing follows the new host.
  attachTo(element) {
    if (this.host === element) return;
    this.resizeObserver.unobserve(this.host);
    this.host = element;
    element.append(this.renderer.domElement);
    this.resizeObserver.observe(element);
    this.resize();
  }

  detach() {
    this.attachTo(this.defaultHost);
  }

  pick(event) {
    if (!this.down || Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) > 5 || this.renderer.xr.isPresenting) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, this.camera);
    const visible = [...this.assets.values()].filter(asset => asset.visible);
    const hits = ray.intersectObjects(visible, true).filter(hit => { let o = hit.object; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
    if (hits.length) {
      let object = hits[0].object;
      while (object) { if (object.name.endsWith('_swing')) { this.onDoor(); break; } object = object.parent; }
    }
  }

  render(time, frame) {
    const dt = Math.min((time - (this.lastTime ?? time)) / 1000, 2); this.lastTime = time;
    for (const [id, pivot] of this.pivots) {
      if (Math.abs(pivot.rotation.y - this.targetDoorAngle(id, pivot)) > 0.00001) this.dirty = true;
    }
    this.animateDoor(this.reducedMotion ? 1 : 1 - Math.exp(-dt * 10));
    if (this.cameraMotion && !this.renderer.xr.isPresenting) {
      this.dirty = true;
      const alpha = 1 - Math.exp(-dt * 7);
      this.camera.position.lerp(this.cameraMotion.position, alpha);
      this.controls.target.lerp(this.cameraMotion.target, alpha);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.cameraMotion.fov, alpha);
      this.camera.updateProjectionMatrix();
      if (this.camera.position.distanceTo(this.cameraMotion.position) < 0.002) this.cameraMotion = null;
    }
    if (this.xrFrame) this.xrFrame(frame);
    if (!this.renderer.xr.isPresenting) this.controls.update();
    if (this.dirty || this.renderer.xr.isPresenting) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }

  snapshot(transparent = false) {
    const background = this.scene.background, stageVisible = this.stage.visible, boxVisible = this.dimensionBox.visible;
    if (transparent) { this.scene.background = null; this.stage.visible = false; this.dimensionBox.visible = false; }
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.background = background; this.stage.visible = stageVisible; this.dimensionBox.visible = boxVisible;
    this.renderer.render(this.scene, this.camera);
    return url;
  }

  exportObject() {
    const group = new THREE.Group();
    for (const [id, asset] of this.assets) {
      const visible = id === 'base_cabin' || id === `door_${this.config.door}-hinge` || id === `heater_${this.config.heater}-control` ||
        id === 'lighting_timber-shade' && this.config.wall || id === 'lighting_under-bench' && this.config.bench;
      if (!visible) continue;
      const clone = asset.clone(true); clone.visible = true;
      clone.traverse(o => { o.visible = true; }); group.add(clone);
    }
    group.updateMatrixWorld(true);
    return group;
  }

  diagnostics() {
    this.model.updateMatrixWorld(true);
    const box = this.assets.has('base_cabin') ? new THREE.Box3().setFromObject(this.assets.get('base_cabin')).getSize(new THREE.Vector3()).toArray() : [];
    return { config: this.config, view: this.view, component: this.component, visible: [...this.assets].filter(([id, object]) => object.visible).map(([id]) => id), bounds: box, pivots: [...this.pivots].map(([id, pivot]) => ({ id, angle: pivot.rotation.y, position: pivot.position.toArray() })), loadMs: this.loadMs, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  disposeObject(root) {
    root.traverse(object => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); }
    });
  }

  dispose() {
    this.disposed = true;
    this.renderer.xr.getSession()?.end();
    this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect(); this.controls.dispose(); this.draco.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.disposeObject(this.scene); this.environment.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
