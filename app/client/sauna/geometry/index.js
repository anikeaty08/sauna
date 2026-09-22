// Public entry point for the parametric sauna builder used by the live 3D
// customizer. See ./cabin.js and ./barrel.js for the coordinate-system and
// tagging conventions - both are shared across every shape.
export { nameOf } from './names.js';
export { MaterialCache } from './materials.js';
import { buildCabinSauna } from './cabin.js';
import { buildBarrelSauna } from './barrel.js';
import { buildRoundSauna } from './round.js';

export function buildSauna(cfg, catalog, materials, lang = 'en') {
  const family = catalog.families[cfg.family] || {};
  if (family.type === 'barrel') return buildBarrelSauna(cfg, catalog, materials, lang);
  if (family.type === 'round') return buildRoundSauna(cfg, catalog, materials, lang);
  return buildCabinSauna(cfg, catalog, materials, lang);
}
