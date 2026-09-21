export const defaults = Object.freeze({ door: 'left', heater: 'integrated', angle: 0, wall: true, bench: true });
export const cabin = Object.freeze({ width: 140, depth: 120, height: 202, doorSweep: 62 });

function toCentimetres(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  return number > 0 && number <= 20 ? number * 100 : number;
}

export function normalizeConfig(value = {}) {
  return {
    door: value.door === 'right' ? 'right' : 'left',
    heater: value.heater === 'external' ? 'external' : 'integrated',
    angle: Number.isFinite(Number(value.angle)) ? Math.min(90, Math.max(0, Number(value.angle))) : 0,
    wall: value.wall !== false && value.wall !== 'false',
    bench: value.bench !== false && value.bench !== 'false',
  };
}

export function loadConfig() {
  const params = new URLSearchParams(location.search);
  if ([...Object.keys(defaults)].some(key => params.has(key))) return normalizeConfig(Object.fromEntries(params));
  try { return normalizeConfig(JSON.parse(localStorage.getItem('sauna-studio-design')) ?? defaults); }
  catch { return { ...defaults }; }
}

export function saveConfig(config) {
  try { localStorage.setItem('sauna-studio-design', JSON.stringify(normalizeConfig(config))); return true; }
  catch { return false; }
}

export function designURL(config) {
  const url = new URL(location.href);
  url.search = new URLSearchParams(normalizeConfig(config)).toString();
  url.hash = '';
  return url.href;
}

export function checkFit({ width, depth, height, rotate = true, door = true }) {
  const sizes = [width, depth, height].map(toCentimetres);
  if (sizes.some(n => !Number.isFinite(n) || n <= 0) || sizes[0] > 2000 || sizes[1] > 2000 || sizes[2] > 1000) {
    return { status: 'invalid', title: 'Check your measurements', detail: 'Enter a positive width, depth and ceiling height in centimetres.' };
  }
  const requiredDepth = cabin.depth + (door ? cabin.doorSweep : 0);
  const straight = sizes[0] >= cabin.width && sizes[1] >= requiredDepth;
  const turned = rotate && sizes[0] >= requiredDepth && sizes[1] >= cabin.width;
  const tall = sizes[2] >= cabin.height;
  const orientation = !straight && turned ? 'turned' : 'straight';
  const required = orientation === 'turned' ? [requiredDepth, cabin.width] : [cabin.width, requiredDepth];
  if ((straight || turned) && tall) {
    const clearance = [sizes[0] - required[0], sizes[1] - required[1], sizes[2] - cabin.height];
    return { status: 'fits', orientation, required, clearance, title: turned && !straight ? 'Fits when turned 90°' : 'Fits within your measurements', detail: `${Math.round(clearance[0] * 10) / 10} cm spare width, ${Math.round(clearance[1] * 10) / 10} cm spare depth and ${Math.round(clearance[2] * 10) / 10} cm above the cabin. Additional installation clearances are not included.` };
  }
  const detail = !tall ? `The cabin is 202 cm high. Your ceiling is ${Math.round((202 - sizes[2]) * 10) / 10} cm too low.` : `Allow at least 140 × ${requiredDepth} cm of clear floor space${door ? ', including the door opening' : ''}${rotate ? ', in either orientation' : ''}.`;
  return { status: 'small', orientation, required, title: 'This space is too small', detail };
}
