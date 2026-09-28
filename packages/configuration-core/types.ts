export type Vec2 = [number, number];

export interface PricedOption {
  id: string;
  name: string;
  /** CHF incl. VAT; null = sold, but the price is only given on request. */
  price: number | null;
  priceNote?: string;
  default?: boolean;
}

export interface HeaterSetOption extends PricedOption {
  heater: string | null;   // module id
  control: string | null;  // module id
}

export interface AccessoryOption extends PricedOption {
  modules: string[];
}

export interface ModelDefinition {
  id: string;
  version: string;
  name: string;
  fullName: string;
  productUrl: string;
  currency: 'CHF';
  vatRate: number;
  basePrice: number;
  dimensions: {
    widthCm: { options: number[]; default: number; surcharge: Record<number, number> };
    depthCm: { options: number[]; default: number; surcharge: Record<number, number> };
    heightMm: number;
  };
  construction: {
    wallMm: number;
    ceilingMm: number;
    glassMm: number;
    slateMm: number;
    fasciaMm: number;
    door: { widthMm: number; heightMm: number };
    controlSegmentMm: number;
    plan: {
      solidBlockWidthRatio: number;
      rightGlassRatio: number;
      upperSideRatio: number;
      cornerSeatLegLongRatio: number;
      cornerSeatLegShortRatio: number;
      heaterGapMm: number;
    };
    benches: {
      longDepthMm: number;
      shortDepthMm: number;
      upperHeightMm: number;
      lowerHeightMm: number;
      lowerDepthMm: number;
      slatMm: number;
      backrestLengthsMm: number[];
    };
  };
  options: {
    benchWood: PricedOption[];
    heaterSet: HeaterSetOption[];
    accessories: AccessoryOption[];
    windows: never[];
    door: { configurable: boolean; description: string };
  };
  sources: string[];
  assumptions: string[];
}

export interface SaunaConfiguration {
  modelId: string;
  modelVersion: string;
  dimensions: { widthCm: number; depthCm: number };
  materials: { benchWood: string };
  heaterSet: string;
  accessories: string[];
  interior: { lowerBenchOffsetMm: number };
}

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  path: string;
  message: string;
}
