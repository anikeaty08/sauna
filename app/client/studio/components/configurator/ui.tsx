import type { ComponentType, ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** Round swatch with its label underneath - the core control of the studio design. */
export function Dot({ selected, label, sub, color, image, icon: Icon, onClick, disabled }: {
  selected?: boolean; label: string; sub?: string; color?: string; image?: string;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>; onClick?: () => void; disabled?: boolean;
}) {
  const style = image ? { backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : color ? { background: color } : undefined;
  return (
    <button type="button" className={`st-dot${selected ? ' is-selected' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={!!selected} title={sub ? `${label} · ${sub}` : label}>
      <span className="st-dot-disc" style={style}>
        {!style && Icon && <Icon size={16} strokeWidth={1.6} />}
        {selected && <Check className="st-dot-tick" size={12} strokeWidth={3} />}
      </span>
      <span className="st-dot-label">{label}</span>
      {sub && <span className="st-dot-sub">{sub}</span>}
    </button>
  );
}

export function Chip({ selected, children, onClick, sub }: { selected?: boolean; children: ReactNode; onClick?: () => void; sub?: string }) {
  return (
    <button type="button" className={`st-chip${selected ? ' is-selected' : ''}`} onClick={onClick} aria-pressed={!!selected} title={sub}>
      {children}
    </button>
  );
}

export function Group({ id, title, children, open, onToggle, refCb }: { id: string; title: string; children: ReactNode; open: boolean; onToggle: () => void; refCb: (el: HTMLElement | null) => void }) {
  return (
    <section className={`st-group${open ? ' is-open' : ''}`} ref={refCb} data-section={id}>
      <button type="button" className="st-group-head" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={15} className="st-group-caret" />
      </button>
      {open && <div className="st-group-body">{children}</div>}
    </section>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <p className="st-note">{children}</p>;
