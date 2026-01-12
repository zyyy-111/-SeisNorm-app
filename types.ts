
export interface RawPoint {
  f: number;
  v: number;
  mode: number;
}

export interface DispersionCurve {
  mode: number;
  frequencies: number[];
  velocities: number[];
  v_up: number[];
  v_lo: number[];
  color: string;
  isExtrapolated: boolean[];
}

export enum NormalizationType {
  SIMPLE = 'Simple (Global Max)',
  WEIGHTED_GAUSSIAN = 'Weighted Gaussian (Adaptive)',
  WEIGHTED_TRIANGULAR = 'Weighted Triangular'
}
