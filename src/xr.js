import * as THREE from 'three';

export async function xrSupport() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const supports = async mode => { try { return !!navigator.xr && await navigator.xr.isSessionSupported(mode); } catch { return false; } };
  const [ar, vr] = await Promise.all([supports('immersive-ar'), supports('immersive-vr')]);
  const android = /Android/.test(navigator.userAgent);
  return { ar, vr, ios, android, xr: !!navigator.xr, camera: !!navigator.mediaDevices?.getUserMedia, secure: isSecureContext };
}

export async function startXR(viewer, mode, overlay, message) {
  const isAR = mode === 'immersive-ar';
  // dom-overlay validates its root when the session is requested, and a hidden root is
  // rejected — so reveal the overlay first and put it back if the request fails.
  overlay.hidden = false;
  let session;
  try {
    session = await navigator.xr.requestSession(mode, isAR ? { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } } : { optionalFeatures: ['local-floor', 'dom-overlay'], domOverlay: { root: overlay } });
  } catch (error) { overlay.hidden = true; throw error; }
  const saved = { position: viewer.model.position.clone(), rotation: viewer.model.quaternion.clone(), camera: viewer.camera.position.clone(), target: viewer.controls.target.clone(), view: viewer.view, component: viewer.component, dimensions: viewer.dimensionBox.visible };
  let hitSource, reticle, controller, ray, ended = false;
  const restore = () => {
    if (ended) return; ended = true;
    hitSource?.cancel(); viewer.xrFrame = null;
    viewer.model.visible = true; viewer.model.position.copy(saved.position); viewer.model.quaternion.copy(saved.rotation);
    viewer.scene.background = new THREE.Color('#e7ebe4'); viewer.stage.visible = true; viewer.controls.enabled = true;
    viewer.dimensionBox.visible = saved.dimensions;
    viewer.component = saved.component; viewer.setView(saved.view, true);
    viewer.camera.position.copy(saved.camera); viewer.controls.target.copy(saved.target);
    if (reticle) { viewer.scene.remove(reticle); reticle.geometry.dispose(); reticle.material.dispose(); }
    if (controller) { controller.removeEventListener('select', select); if (ray) { controller.remove(ray); ray.geometry.dispose(); ray.material.dispose(); } viewer.scene.remove(controller); }
    overlay.hidden = true; viewer.onXR?.(false); viewer.resize();
  };
  let placed = false;
  const select = () => {
    if (isAR) {
      if (reticle?.visible) { viewer.model.position.setFromMatrixPosition(reticle.matrix); viewer.model.visible = true; placed = true; message('Sauna placed at real size. Tap another floor point to move it.'); }
    } else {
      viewer.onDoor();
    }
  };
  session.addEventListener('end', restore, { once: true });
  try {
    viewer.component = 'all'; viewer.setView('exterior', true); viewer.cameraMotion = null;
    viewer.controls.enabled = false; viewer.dimensionBox.visible = isAR;
    viewer.renderer.xr.setReferenceSpaceType(isAR ? 'local' : 'local-floor');
    await viewer.renderer.xr.setSession(session);
    overlay.hidden = false; viewer.onXR?.(true);
    if (isAR) {
      viewer.scene.background = null; viewer.stage.visible = false; viewer.model.visible = false;
      const space = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space });
      reticle = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.115, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x365443 }));
      reticle.matrixAutoUpdate = false; reticle.visible = false; viewer.scene.add(reticle);
      viewer.xrFrame = frame => {
        if (!frame || !hitSource) return;
        const hits = frame.getHitTestResults(hitSource);
        reticle.visible = false;
        if (hits.length) {
          const pose = hits[0].getPose(viewer.renderer.xr.getReferenceSpace());
          if (pose) {
            const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
            // Accept horizontal surfaces only, rather than accidentally placing on a wall.
            if (matrix.elements[5] > 0.85) { reticle.matrix.copy(matrix); reticle.visible = true; if (!placed) message('Floor found. Tap to place the sauna.'); }
          }
        }
      };
      message('Move your phone slowly to find the floor. Placement is a preview, not a clearance check.');
    } else {
      viewer.model.position.set(0, 0, -2.6);
      message('Look around your sauna. Press a controller trigger to open or close the door.');
    }
    controller = viewer.renderer.xr.getController(0); controller.addEventListener('select', select); viewer.scene.add(controller);
    if (!isAR) {
      ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2)]), new THREE.LineBasicMaterial({ color: 0x92ae88 })); controller.add(ray);
    }
    return session;
  } catch (error) { await session.end().catch(() => {}); restore(); throw error; }
}

// Android without WebXR still has ARCore behind Google Scene Viewer, which is what the
// large retail "view in your room" buttons use. It loads the model from a URL itself.
export async function publishModel(viewer) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const data = await new GLTFExporter().parseAsync(viewer.exportObject(), { binary: true });
  const response = await fetch('/api/ar-model', { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: data });
  if (!response.ok) throw new Error(`the model could not be published (${response.status})`);
  const { path } = await response.json();
  return new URL(path, location.href).href;
}

// Chrome only launches an external intent from a real user gesture, so this builds the
// URL for an <a href> the user clicks directly. Uploading first, then navigating, loses
// the activation and Chrome silently returns to the fallback page instead.
// Chrome follows browser_fallback_url when no installed app can handle the intent, which
// otherwise looks exactly like the page reloading itself. The marker lets the page tell
// the user their device has no AR viewer rather than bouncing them to the top silently.
export const AR_STORE = 'https://play.google.com/store/apps/details?id=com.google.ar.core';
export const arLaunchFailed = new URLSearchParams(location.search).get('ar') === 'unavailable';

export function sceneViewerHref(modelURL, title) {
  // resizable=false keeps it at true 1.4 m scale rather than letting a pinch resize it.
  const parameters = new URLSearchParams({ file: modelURL, mode: 'ar_preferred', resizable: 'false', title });
  const back = new URL(location.href);
  back.searchParams.set('ar', 'unavailable');
  const fallback = encodeURIComponent(back.href);
  return `intent://arvr.google.com/scene-viewer/1.0?${parameters}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
}

export function openSceneViewer(modelURL, title) {
  location.href = sceneViewerHref(modelURL, title);
}

export async function createUSDZ(viewer) {
  const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
  const data = await new USDZExporter().parseAsync(viewer.exportObject(), { quickLookCompatible: true, maxTextureSize: 1024 });
  return URL.createObjectURL(new Blob([data], { type: 'model/vnd.usdz+zip' }));
}
