import { useEffect, useState } from 'react';

let cached = null;

export function useCatalog() {
  const [state, setState] = useState(cached ? { ...cached, loading: false } : { catalog: null, presets: null, loading: true, error: null });
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    Promise.all([
      fetch('/data/catalog.json').then(r => { if (!r.ok) throw new Error('catalog'); return r.json(); }),
      fetch('/data/presets.json').then(r => { if (!r.ok) throw new Error('presets'); return r.json(); }),
    ]).then(([catalog, presets]) => {
      cached = { catalog, presets };
      if (!cancelled) setState({ catalog, presets, loading: false, error: null });
    }).catch(error => { if (!cancelled) setState(s => ({ ...s, loading: false, error: error.message })); });
    return () => { cancelled = true; };
  }, []);
  return state;
}
