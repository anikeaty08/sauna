import { useState } from 'react';
import { useStudio } from '../../../store/configurationStore.ts';
import { shareConfiguration, type SavedLink } from '../../../services/saunaApi.ts';

/** Creates (or reuses) the snapshot link for the current design and puts it in the address bar. */
export function useShareLink() {
  const [state, setState] = useState<{ link: SavedLink | null; busy: boolean; error: string | null }>({ link: null, busy: false, error: null });
  const share = async (): Promise<SavedLink | null> => {
    setState(s => ({ ...s, busy: true, error: null }));
    try {
      const link = await shareConfiguration(useStudio.getState().config);
      history.replaceState(null, '', `/studio?c=${link.id}`);
      setState({ link, busy: false, error: null });
      return link;
    } catch (e) {
      setState({ link: null, busy: false, error: (e as Error).message || 'The link could not be created.' });
      return null;
    }
  };
  return { ...state, share };
}
