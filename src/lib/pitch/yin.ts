// Local monophonic pitch detection using the YIN algorithm (de Cheveigné &
// Kawahara, 2002). Pure math over a time-domain Float32Array: no DOM, no Web
// Audio, no network. Returns the fundamental frequency in Hz with a 0..1
// confidence (1 - normalized difference at the chosen lag).

export type YinResult = {
  frequency: number;
  confidence: number;
};

export type YinOptions = {
  /** maximum normalized difference accepted as a period candidate */
  threshold?: number;
  /** lowest detectable frequency in Hz */
  minFrequency?: number;
  /** highest detectable frequency in Hz */
  maxFrequency?: number;
};

const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_MIN_FREQUENCY = 65;
const DEFAULT_MAX_FREQUENCY = 1000;

/**
 * Compute YIN pitch for a time-domain buffer. Returns null when the buffer is
 * too short, effectively silent, or no credible period exists (noise/unvoiced).
 */
export function detectPitch(buffer: Float32Array, sampleRate: number, options: YinOptions = {}): YinResult | null {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minFrequency = options.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;
  const size = buffer.length;
  const half = size >> 1;
  if (half < 16 || sampleRate <= 0) return null;

  const tauMin = Math.max(1, Math.floor(sampleRate / maxFrequency));
  const tauMax = Math.min(Math.floor(sampleRate / minFrequency), half - 1);
  if (tauMin >= tauMax) return null;

  // Difference function over the first half of the window.
  const diff = new Float32Array(half);
  for (let tau = 0; tau < half; tau += 1) {
    let sum = 0;
    for (let i = 0; i < half; i += 1) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference. cmnd[0] is 1 by convention.
  const cmnd = new Float32Array(half);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < half; tau += 1) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
  }

  // Absolute threshold step: first lag below the threshold in range. The CMND
  // of a clean signal descends into the period dip, so the first crossing can
  // sit on the slope; refine to the minimum of the contiguous below-threshold
  // region so the chosen lag is the bottom of the dip rather than its edge.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t += 1) {
    if (cmnd[t] < threshold) {
      tau = t;
      break;
    }
  }

  if (tau >= 0) {
    let end = tau;
    while (end + 1 <= tauMax && cmnd[end + 1] < threshold) end += 1;
    for (let t = tau + 1; t <= end; t += 1) {
      if (cmnd[t] < cmnd[tau]) tau = t;
    }
  }

  // Fallback: the global minimum in range still counts as a period when it is
  // clearly below 1 (weak/partial signal), otherwise the frame is unvoiced.
  if (tau < 0) {
    let minTau = tauMin;
    let minValue = Infinity;
    for (let t = tauMin; t <= tauMax; t += 1) {
      if (cmnd[t] < minValue) {
        minValue = cmnd[t];
        minTau = t;
      }
    }
    if (minValue >= 1) return null;
    tau = minTau;
  }

  // Parabolic interpolation around the chosen lag for sub-sample accuracy.
  let refined = tau;
  if (tau > 0 && tau < half - 1) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denominator = s0 - 2 * s1 + s2;
    if (denominator !== 0) {
      refined = tau + (s0 - s2) / (2 * denominator);
    }
  }

  const frequency = sampleRate / Math.max(refined, 1);
  const confidence = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  return { frequency, confidence };
}
