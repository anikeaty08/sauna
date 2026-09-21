import { useEffect, useRef, useState } from 'react';
import { Camera, X, ArrowRight, Ruler, Check, AlertCircle } from 'lucide-react';
import { api } from './api';
import { checkFit } from './state';
import { createUSDZ, xrSupport, publishModel, sceneViewerHref, arLaunchFailed, AR_STORE } from './xr';

// Routes that anchor the sauna to the real floor, so it stays put as you walk around it.
// Scene Viewer and Quick Look are the system AR viewers and are far more reliable than
// in-page WebXR, so they lead; WebXR is only for headset browsers that have neither.
function arRoute(support) {
  if (!support.secure) return null;
  if (support.android) return 'scene-viewer';
  if (support.ios) return 'quick-look';
  if (support.ar) return 'webxr';
  return null;
}

function arBlocker(support) {
  if (!support.secure) return 'Placing at real size needs an HTTPS address, not a plain LAN address.';
  return 'This device cannot place the sauna at real size, so the preview stays on screen.';
}

export function Modal({ title, eyebrow, onClose, children, className = '' }) {
  const ref = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={className} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} aria-label={title}>
    <div className="dialog-header"><div><span className="collection-label">{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X /></button></div>{children}
  </dialog>;
}

function FloorPlan({ values, result, side }) {
  const width = Number(values.width) > 0 ? Number(values.width) : 220;
  const depth = Number(values.depth) > 0 ? Number(values.depth) : 240;
  const scale = Math.min(290 / Math.max(width, 140), 255 / Math.max(depth, 182));
  const x = (400 - width * scale) / 2, y = 24;
  const turned = result?.orientation === 'turned';
  const sx = turned ? 120 : 140, sy = turned ? 140 : 120;
  const envelopeWidth = turned ? 120 + (values.door ? 62 : 0) : 140;
  const envelopeDepth = turned ? 140 : 120 + (values.door ? 62 : 0);
  const cx = x + Math.max(0, (width - envelopeWidth) * scale / 2);
  const cy = y + Math.max(0, (depth - envelopeDepth) * scale / 2);
  const color = result?.status === 'small' ? '#ac6b45' : '#365443';
  const hinge = side === 'left' ? 6 : 68;
  return <svg id="floor-plan" viewBox="0 0 400 350" role="img" aria-label={`Floor plan: ${width} by ${depth} centimetres, with sauna ${turned ? 'turned 90 degrees' : 'facing forward'}`}>
    <defs><pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#cbd6c3" strokeWidth="0.6" /></pattern></defs>
    <rect width="400" height="350" fill="url(#plan-grid)" />
    <rect x={x} y={y} width={width * scale} height={depth * scale} fill="#fafbf7" stroke="#96a38f" strokeWidth="2" />
    <g transform={`translate(${cx},${cy}) scale(${scale})`}>
      <g transform={turned ? `translate(${envelopeWidth},0) rotate(90)` : ''}>
        <rect width="140" height="120" fill="#dce4d6" stroke={color} strokeWidth="1.5" />
        <path d="M8 20H132" stroke="#b1c0a7" strokeWidth="15" />
        {values.door && <path d={side === 'left' ? `M${hinge} 120h62a62 62 0 0 1 -62 62Z` : `M${hinge} 120h-62a62 62 0 0 0 62 62Z`} fill="#dce4d6" fillOpacity=".5" stroke={color} strokeDasharray="3 3" />}
      </g>
      <text x={sx / 2 + (turned && values.door ? 62 : 0)} y={sy / 2 + 5} textAnchor="middle" fontSize="10">Sauna 140</text>
    </g>
    <text x="200" y="321" textAnchor="middle">{width} cm available width</text>
    <text x="200" y="339" textAnchor="middle" style={{ fontSize: 10 }}>{depth} cm depth · {turned ? 'Cabin turned 90°' : 'Cabin 140 × 120 cm'}</text>
  </svg>;
}

export default function SpaceChecker({ onClose, config, viewer, support, onAR }) {
  const [values, setValues] = useState({ width: '', depth: '', height: '', rotate: true, door: true });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraState, setCameraState] = useState(arLaunchFailed ? 'Your phone has no AR viewer installed, so it returned here. Install Google Play Services for AR below, then tap the camera again.' : '');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [detected, setDetected] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [usdz, setUSDZ] = useState('');
  const [modelURL, setModelURL] = useState('');
  const stream = useRef(null), video = useRef(null), active = useRef(true), url = useRef('');
  const stage = useRef(null);
  const revision = useRef(0);
  useEffect(() => () => { active.current = false; stream.current?.getTracks().forEach(track => track.stop()); if (url.current) URL.revokeObjectURL(url.current); }, []);
  // Publish the model up front so the AR control is a plain link the user clicks. Doing
  // the upload on the tap instead would spend the gesture Chrome needs to launch the
  // Scene Viewer intent, and the browser would quietly return to the fallback page.
  useEffect(() => {
    if (arRoute(support) !== 'scene-viewer' || !viewer) return;
    let alive = true;
    setPreparing(true);
    publishModel(viewer)
      .then(published => { if (alive && active.current) setModelURL(published); })
      .catch(error => { if (alive && active.current) setCameraState(`Could not prepare AR — ${error.message}`); })
      .finally(() => { if (alive && active.current) setPreparing(false); });
    return () => { alive = false; };
  }, [viewer, support.android, support.secure, config.door, config.heater, config.wall, config.bench]);
  // Show the real, orbitable model over the video feed instead of a flat cut-out.
  useEffect(() => {
    if (!cameraOpen || !viewer) return;
    video.current.srcObject = stream.current;
    const background = viewer.scene.background, stageVisible = viewer.stage.visible;
    viewer.scene.background = null; viewer.stage.visible = false;
    viewer.attachTo(stage.current);
    // Re-check here rather than on the tap: awaiting support would spend the user
    // activation that requestSession needs, and the AR button is its own fresh tap.
    xrSupport().then(live => { if (active.current) setDetected(live); }).catch(() => {});
    return () => { viewer.scene.background = background; viewer.stage.visible = stageVisible; viewer.detach(); };
  }, [cameraOpen, viewer]);

  async function placeAtRealSize() {
    const route = arRoute(detected || support);
    // WebXR stays in the page, so it must start on this tap before any await.
    if (route === 'webxr') { onAR(); stopCamera(); onClose(); return; }
    setPreparing(true);
    setCameraState('Preparing your sauna for AR…');
    try {
      const generated = await createUSDZ(viewer);
      if (!active.current) { URL.revokeObjectURL(generated); return; }
      url.current = generated; setUSDZ(generated);
      setCameraState('Ready. Tap Open in AR to place it at real size.');
    } catch (error) { setCameraState(`Could not prepare AR — ${error.message}. The preview still works.`); }
    finally { if (active.current) setPreparing(false); }
  }
  function change(key, value) { revision.current++; setValues(v => ({ ...v, [key]: value })); setResult(null); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); const version = revision.current;
    const body = { ...values, width: Number(values.width), depth: Number(values.depth), height: Number(values.height) };
    try { const answer = await api('/fit', body); if (active.current && version === revision.current) setResult(answer); }
    catch { if (active.current && version === revision.current) setResult({ ...checkFit(body), offline: true }); }
    finally { if (active.current) setBusy(false); }
  }
  // Real AR first: the sauna anchors to the floor and stays there as you walk around it.
  // The on-screen overlay below is only for devices with no AR viewer at all.
  async function camera() {
    if (!viewer) return setCameraState('The model is still loading. Please try again in a moment.');
    const route = arRoute(detected || support);
    if (route && route !== 'scene-viewer') return placeAtRealSize();
    if (!support.camera) return setCameraState(`Camera access needs an HTTPS address. ${arBlocker(support)}`);
    setCameraState('Waiting for camera permission…');
    const waiting = setTimeout(() => { if (active.current) setCameraState('Still waiting for permission. Tap the padlock beside the address, allow Camera, then tap again.'); }, 8000);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!active.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = media;
      viewer.component = 'all'; viewer.setView('exterior', true);
      setCameraOpen(true);
      setCameraState('Drag to turn the sauna, pinch to size it. This preview is not tracked or measured.');
    } catch (error) { setCameraState(error.name === 'NotAllowedError' ? 'Camera permission was declined. Allow Camera for this site in your browser settings, then tap again.' : `Camera unavailable — ${error.name}: ${error.message}`); }
    finally { clearTimeout(waiting); }
  }
  function stopCamera() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setCameraOpen(false); }
  const Icon = result?.status === 'fits' ? Check : result ? AlertCircle : Ruler;
  return <Modal title="Make sure there’s room." eyebrow="Bring it home" onClose={onClose}>
    <div className="space-layout"><div className="space-visual"><div className="plan-heading"><span>Your floor plan</span><span>Dimensions in centimetres</span></div><FloorPlan values={values} result={result} side={config.door} /><div className="plan-legend"><span><i />Cabin footprint</span><span><i className="dashed" />Door opening</span></div><div className="required-space"><span>Cabin footprint<b>1.68 m²</b></span><span>Cabin height<b>202 cm</b></span></div></div>
    <div className="space-form"><p>Enter the clear space you have available. Use centimetres, measured wall to wall.</p><form onSubmit={submit}><div className="measure-inputs">{[['width','Width'],['depth','Depth'],['height','Ceiling height']].map(([key,label]) => <label key={key}>{label}<span><input type="number" name={key} aria-label={label} value={values[key]} onChange={event => change(key,event.target.value)} min="1" max={key === 'height' ? 1000 : 2000} step="0.1" placeholder={key === 'width' ? '200' : '240'} required inputMode="decimal" />cm</span></label>)}</div><label className="check-row"><input type="checkbox" checked={values.rotate} onChange={event => change('rotate',event.target.checked)} />Allow the cabin to turn 90°</label><label className="check-row"><input type="checkbox" checked={values.door} onChange={event => change('door',event.target.checked)} />Include 62 cm for the door to open</label><button className="primary-button" disabled={busy}>{busy ? 'Checking…' : 'Check the dimensions'}<ArrowRight /></button></form>
    <div className={`fit-result ${result?.status || ''}`} role="status"><Icon /><div><b>{result?.title || 'Let’s find its place.'}</b><p>{result?.detail || 'Add your measurements to check the fit.'}</p>{result?.offline && <small>Calculated on this device; server unavailable.</small>}</div></div><p className="fit-note">Checks the cabin and door envelope only. Installation, ventilation and service clearances must be confirmed separately.</p><div className="camera-entry"><span><b>See it in your room</b><small>Placed on your floor at real size</small></span>{arRoute(detected || support) === 'scene-viewer' ? <a className="icon-button" aria-label="View in your room" aria-disabled={!modelURL} href={modelURL ? sceneViewerHref(modelURL, 'Sauna 140') : undefined}><Camera /></a> : <button type="button" className="icon-button" aria-label="View in your room" onClick={camera}><Camera /></button>}</div><p className="camera-support" role="status">{cameraState || (arRoute(detected || support) !== 'scene-viewer' ? (arRoute(detected || support) ? 'Opens your camera and anchors the sauna to your floor at 140 × 120 × 202 cm.' : arBlocker(support)) : preparing || !modelURL ? 'Preparing your sauna for AR…' : 'Ready. Tap the camera to anchor it on your floor at 140 × 120 × 202 cm, then walk around it.')}</p>{usdz && <a className="quicklook-button" rel="ar" href={`${usdz}#allowsContentScaling=0`}><img width="20" height="20" src="/favicon.svg" alt="Open in AR" /></a>}{arLaunchFailed && <a className="secondary-button" href={AR_STORE} target="_blank" rel="noreferrer">Install Google Play Services for AR<ArrowRight /></a>}</div></div>
    {cameraOpen && <div className="camera-preview"><video ref={video} autoPlay playsInline muted /><div className="camera-stage" ref={stage} /><div className="camera-preview-label">Live preview · Drag to turn · Pinch to size · Not measured</div>
      <div className="camera-actions">
        {arRoute(detected || support) && <button className="secondary-button" disabled={preparing} onClick={placeAtRealSize}>{preparing ? 'Preparing…' : 'Place at real size'}</button>}
        <button className="secondary-button" id="stop-camera" onClick={stopCamera}>Close camera</button>
      </div></div>}
  </Modal>;
}
