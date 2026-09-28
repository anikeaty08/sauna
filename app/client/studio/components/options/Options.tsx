import { PackagePlus, Flame, Ban } from 'lucide-react';
import { useStudio } from '../../store/configurationStore.ts';
import { chf, chfDelta } from '../../utils/format.ts';
import { Chip, Dot, Note } from '../configurator/ui.tsx';

const WOOD_SWATCH: Record<string, string> = { espe: '/textures/production/wood/espe.jpg', erle: '/textures/production/wood/erle.jpg' };

/** Width and depth: the real 10 cm steps and surcharges from holzsauna.ch. */
export function DimensionControls() {
  const { model, config, update } = useStudio();
  const w = model.dimensions.widthCm, d = model.dimensions.depthCm;
  return (
    <>
      <p className="st-sub">Width</p>
      <div className="st-chips">
        {w.options.map(v => <Chip key={v} selected={config.dimensions.widthCm === v} sub={chfDelta(w.surcharge[v])} onClick={() => update({ dimensions: { ...config.dimensions, widthCm: v } })}>{v} cm</Chip>)}
      </div>
      <p className="st-sub">Depth</p>
      <div className="st-chips">
        {d.options.map(v => <Chip key={v} selected={config.dimensions.depthCm === v} sub={chfDelta(d.surcharge[v])} onClick={() => update({ dimensions: { ...config.dimensions, depthCm: v } })}>{v} cm</Chip>)}
      </div>
      <Note>Height {model.dimensions.heightMm / 10} cm (standard). Width {chfDelta(w.surcharge[config.dimensions.widthCm])}, depth {chfDelta(d.surcharge[config.dimensions.depthCm])}.</Note>
    </>
  );
}

/** Door and windows: the product has one fixed door and no windows - stated, not faked. */
export function DoorSelector() {
  const model = useStudio(s => s.model);
  return (
    <>
      <p className="st-sub">Door</p>
      <div className="st-dots">
        <Dot selected label="Glass door 67 × 187.5" sub="included" color="linear-gradient(135deg,#eef5f2,#cfdcd8)" />
      </div>
      <Note>{model.options.door.description}</Note>
      <p className="st-sub">Windows</p>
      <Note>Not offered for this model - the whole front is glass.</Note>
    </>
  );
}

/** Bench wood (the real Espe/Erle choice) plus the fixed exterior finishes. */
export function MaterialSelector() {
  const { model, config, update } = useStudio();
  return (
    <>
      <p className="st-sub">Benches & backrests</p>
      <div className="st-dots">
        {model.options.benchWood.map(o => (
          <Dot key={o.id} selected={config.materials.benchWood === o.id} label={o.name.split(',')[0]} sub={chfDelta(o.price, o.priceNote)} image={WOOD_SWATCH[o.id]} onClick={() => update({ materials: { benchWood: o.id } })} />
        ))}
      </div>
      <p className="st-sub">Walls, ceiling & exterior (standard)</p>
      <div className="st-dots">
        <Dot selected label="Zirbe 40 mm" sub="included" image="/textures/production/wood/zirbe_boards.jpg" />
        <Dot selected label="Slate panels" sub="included" image="/textures/production/slate/slate_tiles.jpg" />
      </div>
    </>
  );
}

/** The five heater + control sets exactly as sold on holzsauna.ch; each heater is its own module. */
export function HeaterSelector() {
  const { model, config, update } = useStudio();
  const current = model.options.heaterSet.find(o => o.id === config.heaterSet);
  return (
    <>
      <div className="st-dots">
        {model.options.heaterSet.map(o => (
          <Dot key={o.id} selected={config.heaterSet === o.id} label={o.id === 'none' ? 'No heater' : o.name.replace(/^Set: /, '').split(',')[0]} sub={chfDelta(o.price, o.priceNote)}
            icon={o.heater ? Flame : Ban} color={o.heater ? '#1d1e20' : undefined} onClick={() => update({ heaterSet: o.id })} />
        ))}
      </div>
      {current && <Note>{current.name}{current.priceNote ? ` - ${current.priceNote}.` : ''}</Note>}
    </>
  );
}

/** The movable lower bench can be slid out of the corner (visual only, no price). */
export function InteriorLayoutSelector() {
  const { config, update, layout, model } = useStudio();
  const b = model.construction.benches;
  return (
    <>
      <Note>Upper long bench {(layout.benches.long.depth * 100).toFixed(1)} cm, upper short bench {b.shortDepthMm / 10} cm, 2 slightly rounded backrests, under-bench cladding on both upper benches.</Note>
      <p className="st-sub">Lower bench position (movable)</p>
      <input className="st-range" type="range" min={0} max={400} step={10} value={config.interior.lowerBenchOffsetMm}
        onChange={e => update({ interior: { lowerBenchOffsetMm: Number(e.target.value) } })} aria-label="Lower bench distance from the corner" />
      <Note>{config.interior.lowerBenchOffsetMm / 10} cm out of the corner{layout.benches.lower ? '' : ' - no free floor at this position'}.</Note>
    </>
  );
}

export function AccessorySelector() {
  const { model, config, update } = useStudio();
  const toggle = (id: string) => update({ accessories: config.accessories.includes(id) ? config.accessories.filter(a => a !== id) : [...config.accessories, id] });
  return (
    <div className="st-dots">
      {model.options.accessories.map(o => (
        <Dot key={o.id} selected={config.accessories.includes(o.id)} label={o.name} sub={o.price ? `+${chf(o.price)}` : 'on request'} icon={PackagePlus} onClick={() => toggle(o.id)} />
      ))}
    </div>
  );
}
