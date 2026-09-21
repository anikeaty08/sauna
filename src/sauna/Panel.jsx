import { Check, Plus, X, Flame, Gauge, Lightbulb, PackagePlus, DoorOpen, Ruler, Layers, Trash2 } from 'lucide-react';
import { chf, chfDelta } from './format';
import { nameOf, woodHex, heaterSpecLine, fitsVolume, controlSpecLine, shortFamily } from './options';
import { widthOptions, depthOptions } from './config';

function Swatch({ selected, title, subtitle, price, color, onClick, disabled, flag }) {
  return (
    <button type="button" className={`opt-swatch ${selected ? 'is-selected' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {color && <span className="opt-swatch-color" style={{ background: color }} />}
      <span className="opt-swatch-text">
        <b>{title}</b>
        {subtitle && <small>{subtitle}</small>}
        {flag && <small className="opt-flag">{flag}</small>}
      </span>
      <span className="opt-swatch-price">{price === 0 ? 'included' : chfDelta(price)}</span>
      {selected && <Check className="opt-swatch-check" />}
    </button>
  );
}

function ListRow({ checked, title, subtitle, price, onToggle, onRemove }) {
  return (
    <label className={`opt-row ${checked ? 'is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="opt-row-box" aria-hidden="true">{checked ? <Check /> : <Plus />}</span>
      <span className="opt-row-text"><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
      <span className="opt-row-price">{price ? chf(price) : 'on request'}</span>
      {checked && onRemove && <button type="button" className="opt-row-remove" onClick={e => { e.preventDefault(); onRemove(); }} aria-label={`Remove ${title}`}><Trash2 /></button>}
    </label>
  );
}

function StepSlider({ label, value, onChange, min, max, step = 1, unit = 'cm' }) {
  return (
    <label className="stepper">
      <span>{label}<b>{value} {unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Section({ id, title, icon: Icon, open, children }) {
  return (
    <details className="panel-section" id={`section-${id}`} open={open}>
      <summary><Icon /><span>{title}</span></summary>
      <div className="panel-section-body">{children}</div>
    </details>
  );
}

const ENTRY_SHORT = { front: 'Front entry', corner: 'Corner entry', glasfront: 'Glass front', corner_glasfront: 'Corner + glass', glass_corner: 'Glass corner' };
const CLADDING_SHORT = { none: 'Natural wood', schiefer: 'Slate tiles', altholz: 'Reclaimed spruce' };

function HeaterList({ catalog, cfg, volumeM3, onSetHeater }) {
  return (
    <div className="opt-list">
      {Object.entries(catalog.heaters).map(([key, spec]) => (
        <Swatch key={key} selected={cfg.heater.sku === key} title={nameOf(spec).split(', incl.')[0]} subtitle={heaterSpecLine(spec)}
          flag={fitsVolume(spec, volumeM3) ? '' : 'not rated for this cabin size'} price={spec.price} onClick={() => onSetHeater({ sku: key })} />
      ))}
    </div>
  );
}
function ControlList({ catalog, cfg, onSetCfg }) {
  return (
    <div className="opt-list">
      <Swatch selected={cfg.control === 'none'} title="No separate control unit" subtitle="For heaters with built-in controls" price={0} onClick={() => onSetCfg({ control: 'none' })} />
      {Object.entries(catalog.controls).filter(([k]) => k !== 'none').map(([key, spec]) => (
        <Swatch key={key} selected={cfg.control === key} title={nameOf(spec).replace('HUUM UKU 4.2 control, ', 'HUUM UKU 4.2 · ')} subtitle={controlSpecLine(spec)} price={spec.price} onClick={() => onSetCfg({ control: key })} />
      ))}
    </div>
  );
}
function InteriorList({ catalog, cfg, family, onSetInterior }) {
  return (
    <div className="opt-grid">
      {family.interior_options.map(key => {
        const spec = catalog.interiors[key];
        return <Swatch key={key} selected={cfg.interior.material === key} title={nameOf(spec)} price={spec.price} color={woodHex(catalog, spec.wood)} onClick={() => onSetInterior({ material: key })} />;
      })}
    </div>
  );
}
function ToggleList({ entries, selected, listKey, onToggleList }) {
  return (
    <div className="opt-list">
      {entries.map(([key, spec]) => (
        <ListRow key={key} checked={selected.includes(key)} title={nameOf(spec)} price={spec.price}
          onToggle={() => onToggleList(listKey, key)} onRemove={() => onToggleList(listKey, key)} />
      ))}
    </div>
  );
}

/** The always-visible configurator: every section a customer can browse without touching the model. */
export function ConfiguratorPanel({ catalog, cfg, openId, volumeM3, onSetCfg, onSetInterior, onSetDoor, onSetHeater, onToggleList, warnings }) {
  const family = catalog.families[cfg.family];
  return (
    <div className="panel-sections">
      <Section id="cabin" title="Cabin & size" icon={Ruler} open={openId === 'cabin' || !openId}>
        <p className="panel-label">Wood & construction</p>
        <div className="opt-grid">
          {Object.entries(catalog.families).map(([key, f]) => (
            <Swatch key={key} selected={cfg.family === key} title={shortFamily(f)} subtitle={`from ${chf(f.base_price || f.sizes[0].aktion)}`}
              color={woodHex(catalog, f.wall_wood)} price={0} onClick={() => onSetCfg({ family: key })} />
          ))}
        </div>
        <p className="panel-label">Dimensions</p>
        <div className="dims-row">
          <label>Width<select value={cfg.widthCm} onChange={e => onSetCfg({ widthCm: Number(e.target.value) })}>
            {widthOptions(family).map(w => <option key={w} value={w}>{w} cm</option>)}
          </select></label>
          <label>Depth<select value={cfg.depthCm} onChange={e => onSetCfg({ depthCm: Number(e.target.value) })}>
            {depthOptions(family).map(d => <option key={d} value={d}>{d} cm</option>)}
          </select></label>
        </div>
        <StepSlider label="Height" value={cfg.heightCm} onChange={v => onSetCfg({ heightCm: v })} min={190} max={220} step={2} />
        <p className="dims-note">Interior volume approx. {volumeM3} m³ · boards {cfg.boardOrientation}</p>
        <div className="opt-grid opt-grid-2">
          <Swatch selected={cfg.boardOrientation === 'horizontal'} title="Horizontal boards" price={0} onClick={() => onSetCfg({ boardOrientation: 'horizontal' })} />
          <Swatch selected={cfg.boardOrientation === 'vertical'} title="Vertical boards" price={0} onClick={() => onSetCfg({ boardOrientation: 'vertical' })} />
        </div>
        <p className="panel-label">Entry & glazing</p>
        <div className="opt-grid opt-grid-3">
          {family.entries.map(key => (
            <Swatch key={key} selected={cfg.entry === key} title={ENTRY_SHORT[key]} price={(family.entry_prices || {})[key] || 0} onClick={() => onSetCfg({ entry: key })} />
          ))}
        </div>
        <p className="panel-label">Exterior finish</p>
        <div className="opt-grid opt-grid-3">
          {Object.entries(catalog.claddings).map(([key, c]) => (
            <Swatch key={key} selected={(cfg.cladding || 'none') === key} title={CLADDING_SHORT[key]} price={c.price}
              color={key === 'schiefer' ? '#2b2e31' : key === 'altholz' ? woodHex(catalog, 'altholz') : woodHex(catalog, family.wall_wood)}
              onClick={() => onSetCfg({ cladding: key })} />
          ))}
        </div>
      </Section>

      <Section id="door" title="Door & window" icon={DoorOpen} open={openId === 'door'}>
        <p className="panel-label">Hinge side (seen from outside)</p>
        <div className="opt-grid opt-grid-2">
          <Swatch selected={cfg.door.hinge === 'left'} title="Hinged left" price={0} onClick={() => onSetDoor({ hinge: 'left' })} />
          <Swatch selected={cfg.door.hinge === 'right'} title="Hinged right" price={0} onClick={() => onSetDoor({ hinge: 'right' })} />
        </div>
        {['corner', 'corner_glasfront', 'glass_corner'].includes(cfg.entry) ? (
          <>
            <p className="panel-label">Which corner</p>
            <div className="opt-grid opt-grid-2">
              <Swatch selected={cfg.door.corner === 'left'} title="Front-left corner" price={0} onClick={() => onSetDoor({ corner: 'left' })} />
              <Swatch selected={cfg.door.corner === 'right'} title="Front-right corner" price={0} onClick={() => onSetDoor({ corner: 'right' })} />
            </div>
          </>
        ) : (
          <>
            <p className="panel-label">Door position</p>
            <div className="opt-grid opt-grid-3">
              {[['left', 'Left'], ['centre', 'Centre'], ['right', 'Right']].map(([key, label]) => (
                <Swatch key={key} selected={cfg.door.position === key} title={label} price={0} onClick={() => onSetDoor({ position: key })} />
              ))}
            </div>
          </>
        )}
        {['front', 'corner'].includes(cfg.entry) && (
          <>
            <p className="panel-label">Window</p>
            <div className="opt-grid opt-grid-3">
              {[['none', 'No window'], ['auto', 'Full-height'], ['60', '60 cm wide']].map(([key, label]) => (
                <Swatch key={key} selected={String(cfg.window) === key} title={label} price={key !== 'none' && family.window_price ? family.window_price : 0} onClick={() => onSetCfg({ window: key })} />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section id="interior" title="Benches & interior" icon={Layers} open={openId === 'interior'}>
        <p className="panel-label">Bench wood</p>
        <InteriorList catalog={catalog} cfg={cfg} family={family} onSetInterior={onSetInterior} />
        <p className="panel-label">Layout</p>
        <div className="opt-grid opt-grid-3">
          {[['straight', 'Straight'], ['L', 'L-shape'], ['U', 'U-shape']].map(([key, label]) => (
            <Swatch key={key} selected={cfg.interior.layout === key} title={label} price={0} onClick={() => onSetInterior({ layout: key })} />
          ))}
        </div>
        <div className="dims-row">
          <StepSlider label="Upper bench depth" value={cfg.interior.upperDepthCm} onChange={v => onSetInterior({ upperDepthCm: v })} min={40} max={70} />
          <StepSlider label="Lower bench depth" value={cfg.interior.lowerDepthCm} onChange={v => onSetInterior({ lowerDepthCm: v })} min={25} max={50} />
        </div>
        <div className="dims-row">
          <StepSlider label="Upper bench height" value={cfg.interior.upperHeightCm} onChange={v => onSetInterior({ upperHeightCm: v })} min={75} max={100} />
          <StepSlider label="Lower bench height" value={cfg.interior.lowerHeightCm} onChange={v => onSetInterior({ lowerHeightCm: v })} min={35} max={55} />
        </div>
        <div className="switch-grid">
          {[['backrests', 'Backrests'], ['sideBackrests', 'Side backrests'], ['apron', 'Under-bench cladding'], ['floorGrate', 'Floor grating'], ['slidingStool', 'Sliding lower bench']].map(([key, label]) => (
            <label key={key} className="mini-switch"><input type="checkbox" checked={cfg.interior[key]} onChange={e => onSetInterior({ [key]: e.target.checked })} />{label}</label>
          ))}
        </div>
        <StepSlider label="Headrests" value={cfg.interior.headrests} onChange={v => onSetInterior({ headrests: v })} min={0} max={3} unit="" />
      </Section>

      <Section id="heater" title="Heater" icon={Flame} open={openId === 'heater'}>
        <HeaterList catalog={catalog} cfg={cfg} volumeM3={volumeM3} onSetHeater={onSetHeater} />
        <p className="panel-label">Position</p>
        <div className="opt-grid opt-grid-2">
          {[['front_right', 'Front right'], ['front_left', 'Front left'], ['back_right', 'Back right'], ['back_left', 'Back left']].map(([key, label]) => (
            <Swatch key={key} selected={cfg.heater.position === key} title={label} price={0} onClick={() => onSetHeater({ position: key })} />
          ))}
        </div>
        <label className="mini-switch"><input type="checkbox" checked={cfg.ventilation} onChange={e => onSetCfg({ ventilation: e.target.checked })} />Supply &amp; exhaust vents</label>
      </Section>

      <Section id="control" title="Control unit" icon={Gauge} open={openId === 'control'}>
        <ControlList catalog={catalog} cfg={cfg} onSetCfg={onSetCfg} />
      </Section>

      <Section id="lighting" title="Lighting" icon={Lightbulb} open={openId === 'lighting'}>
        <ToggleList entries={Object.entries(catalog.lighting)} selected={cfg.lighting} listKey="lighting" onToggleList={onToggleList} />
      </Section>

      <Section id="accessory" title="Accessories & delivery" icon={PackagePlus} open={openId === 'accessory'}>
        <ToggleList entries={Object.entries(catalog.accessories)} selected={cfg.accessories} listKey="accessories" onToggleList={onToggleList} />
        <p className="panel-label">Assembly &amp; delivery</p>
        <ToggleList entries={Object.entries(catalog.services)} selected={cfg.services} listKey="services" onToggleList={onToggleList} />
      </Section>

      {warnings.length > 0 && (
        <div className="panel-warnings">
          <b>Good to know</b>
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
    </div>
  );
}

const CATEGORY_LABEL = { cabin: 'Cabin', door: 'Door', interior: 'Benches & interior', heater: 'Heater', control: 'Control unit', lighting: 'Lighting', accessory: 'Accessories' };
const CATEGORY_HINT = {
  interior: 'Choose the bench wood. Layout and bench sizes are in the panel on the right.',
  heater: 'Pick a heater to swap it in. The total updates instantly.',
  control: 'Wall control units for heaters without built-in controls.',
  lighting: 'Tick to add a light, untick or use the bin to remove it.',
  accessory: 'Tick to add, untick or use the bin to remove.',
  door: 'Choose which side the glass door is hinged on.',
  cabin: 'Size, wood and exterior finish are in “Cabin & size” in the panel on the right.',
};

/** The overlay that appears when a customer clicks a part in the 3D model:
 *  only that part's options, large and simple, with a way back to the full panel. */
export function ComponentDrawer({ category, catalog, cfg, volumeM3, onClose, selectedName, ...handlers }) {
  if (!category) return null;
  const family = catalog.families[cfg.family];
  let body = null;
  if (category === 'door') {
    body = <div className="opt-grid opt-grid-2">
      <Swatch selected={cfg.door.hinge === 'left'} title="Hinged left" price={0} onClick={() => handlers.onSetDoor({ hinge: 'left' })} />
      <Swatch selected={cfg.door.hinge === 'right'} title="Hinged right" price={0} onClick={() => handlers.onSetDoor({ hinge: 'right' })} />
    </div>;
  } else if (category === 'interior') {
    body = <InteriorList catalog={catalog} cfg={cfg} family={family} onSetInterior={handlers.onSetInterior} />;
  } else if (category === 'heater') {
    body = <HeaterList catalog={catalog} cfg={cfg} volumeM3={volumeM3} onSetHeater={handlers.onSetHeater} />;
  } else if (category === 'control') {
    body = <ControlList catalog={catalog} cfg={cfg} onSetCfg={handlers.onSetCfg} />;
  } else if (category === 'lighting') {
    body = <ToggleList entries={Object.entries(catalog.lighting)} selected={cfg.lighting} listKey="lighting" onToggleList={handlers.onToggleList} />;
  } else if (category === 'accessory') {
    body = <ToggleList entries={Object.entries(catalog.accessories)} selected={cfg.accessories} listKey="accessories" onToggleList={handlers.onToggleList} />;
  }
  return (
    <div className="component-drawer" role="dialog" aria-label={`${CATEGORY_LABEL[category] || category} options`}>
      <div className="component-drawer-head">
        <div>
          <h3>{CATEGORY_LABEL[category] || category}</h3>
          {selectedName && <small>{selectedName}</small>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <p className="drawer-hint">{CATEGORY_HINT[category]}</p>
      <div className="component-drawer-body">{body}</div>
    </div>
  );
}
