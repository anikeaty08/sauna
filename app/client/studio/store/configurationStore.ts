import { create } from 'zustand';
import { defaultConfiguration, zirbe6eck, type SaunaConfiguration } from '../../../../packages/configuration-core/index.ts';
import { evaluate, type EngineResult } from '../features/sauna/configuration/configurationEngine.ts';

export type Tab = 'exterior' | 'interior';
export type Section = 'size' | 'door' | 'wood' | 'heater' | 'layout' | 'extras';

interface StudioState extends EngineResult {
  tab: Tab;
  section: Section;
  /** Bumped by "Reset view" so the camera rig re-frames. */
  viewNonce: number;
  update: (patch: Partial<SaunaConfiguration>) => void;
  reset: () => void;
  load: (config: Partial<SaunaConfiguration>) => void;
  setSection: (section: Section) => void;
  setTab: (tab: Tab) => void;
  resetView: () => void;
}

export const SECTION_TAB: Record<Section, Tab> = { size: 'exterior', door: 'exterior', wood: 'interior', heater: 'interior', layout: 'interior', extras: 'interior' };
const TAB_FIRST: Record<Tab, Section> = { exterior: 'size', interior: 'wood' };

const initial = evaluate(defaultConfiguration(zirbe6eck), null);

/** Central configuration state; every panel control and the viewer read from here. */
export const useStudio = create<StudioState>((set, get) => ({
  ...initial,
  tab: 'exterior',
  section: 'size',
  viewNonce: 0,
  update: patch => {
    const prev = get().config;
    const merged = {
      ...prev, ...patch,
      dimensions: { ...prev.dimensions, ...patch.dimensions },
      materials: { ...prev.materials, ...patch.materials },
      interior: { ...prev.interior, ...patch.interior },
    };
    set(evaluate(merged, prev));
  },
  reset: () => set({ ...evaluate(defaultConfiguration(get().model), get().config) }),
  load: config => set(evaluate({ ...defaultConfiguration(zirbe6eck), ...config, modelId: config.modelId ?? zirbe6eck.id }, get().config)),
  setSection: section => set({ section, tab: SECTION_TAB[section] }),
  setTab: tab => set({ tab, section: TAB_FIRST[tab] }),
  resetView: () => set(s => ({ viewNonce: s.viewNonce + 1 })),
}));
