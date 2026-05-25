import type { DiodeSeries } from './regression';

/**
 * Demo fixture: the three bypass diodes of the Mitsui R.MQT18.1v01 evaluation
 * (WAAREE-770). Each point is the averaged (T_j, V_D) measured at the four
 * IEC 61215-2 MQT 18.1 calibration set-points (30 / 50 / 70 / 90 °C). The
 * per-diode linear characteristics recover slope ≈ -1.05e-3 V/°C, intercept
 * ≈ 0.456 V, R² > 0.99 — i.e. V_D ≈ -0.0011·T_j + 0.4558.
 *
 * T_jmax is "from datasheet" in the source template (not provided for this
 * sample); 200 °C is used as a representative diode absolute-max so the demo
 * panel shows a populated, passing extrapolation.
 */
export const DEMO_DIODES: DiodeSeries[] = [
  {
    diodeId: 'Diode 1',
    tjmaxc: 200,
    points: [
      { tjc: 30.163, vdropv: 0.42502 },
      { tjc: 48.947, vdropv: 0.40648 },
      { tjc: 69.568, vdropv: 0.38472 },
      { tjc: 88.468, vdropv: 0.3651 },
    ],
  },
  {
    diodeId: 'Diode 2',
    tjmaxc: 200,
    points: [
      { tjc: 30.163, vdropv: 0.42243 },
      { tjc: 48.973, vdropv: 0.40629 },
      { tjc: 69.571, vdropv: 0.38141 },
      { tjc: 88.465, vdropv: 0.36168 },
    ],
  },
  {
    diodeId: 'Diode 3',
    tjmaxc: 200,
    points: [
      { tjc: 30.163, vdropv: 0.42215 },
      { tjc: 48.973, vdropv: 0.40628 },
      { tjc: 69.571, vdropv: 0.38141 },
      { tjc: 88.465, vdropv: 0.36175 },
    ],
  },
];
