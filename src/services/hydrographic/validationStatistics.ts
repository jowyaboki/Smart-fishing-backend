import {
  MatchedTidalPeak,
  PeakValidationMetrics,
  StatisticalMetrics,
  ValidationObservationPair,
} from '../../domain/tideValidationModels';

/**
 * Calculates statistical metrics (Bias, MAE, RMSE, StdDev, MaxAbsError, MinAbsError)
 * for a collection of observation-prediction pairs.
 *
 * Residual defined as e_i = predicted - observed:
 * - Bias (Mean Error): (1/N) * sum(e_i)
 * - MAE: (1/N) * sum(|e_i|)
 * - RMSE: sqrt((1/N) * sum(e_i^2))
 * - Standard Deviation: sqrt((1/N) * sum((e_i - Bias)^2))
 * - Max Absolute Error: max(|e_i|)
 * - Min Absolute Error: min(|e_i|)
 */
export function calculateStatisticalMetrics(
  pairs: ValidationObservationPair[]
): StatisticalMetrics {
  const n = pairs.length;
  if (n === 0) {
    throw new Error('Cannot calculate statistical metrics for an empty dataset');
  }

  const errors = pairs.map((p) => p.predictedWaterLevelMeters - p.observedWaterLevelMeters);

  let sumError = 0;
  let sumAbsError = 0;
  let sumSquaredError = 0;
  let maxAbs = -Infinity;
  let minAbs = Infinity;

  for (let i = 0; i < n; i++) {
    const err = errors[i];
    const absErr = Math.abs(err);

    sumError += err;
    sumAbsError += absErr;
    sumSquaredError += err * err;

    if (absErr > maxAbs) maxAbs = absErr;
    if (absErr < minAbs) minAbs = absErr;
  }

  const bias = sumError / n;
  const mae = sumAbsError / n;
  const rmse = Math.sqrt(sumSquaredError / n);

  // Standard deviation of errors relative to the mean error (bias)
  let sumSquaredDeviation = 0;
  for (let i = 0; i < n; i++) {
    const diff = errors[i] - bias;
    sumSquaredDeviation += diff * diff;
  }
  const standardDeviation = Math.sqrt(sumSquaredDeviation / n);

  // Round metrics to 4 decimal places for clean floating point representation
  return {
    totalPairs: n,
    biasMeters: Math.round(bias * 10000) / 10000,
    maeMeters: Math.round(mae * 10000) / 10000,
    rmseMeters: Math.round(rmse * 10000) / 10000,
    standardDeviationMeters: Math.round(standardDeviation * 10000) / 10000,
    maxAbsoluteErrorMeters: Math.round(maxAbs * 10000) / 10000,
    minAbsoluteErrorMeters: Math.round(minAbs * 10000) / 10000,
  };
}

export interface DiscreteWaterLevelPoint {
  timestampUtc: string;
  timeMs: number;
  heightMeters: number;
}

export interface ExtremaPoint {
  type: 'High' | 'Low';
  timestampUtc: string;
  timeMs: number;
  heightMeters: number;
}

/**
 * Detects local extrema (high and low peaks) from discrete water level time-series.
 * Requires windowing or 3-point local extrema checking (y[i-1] < y[i] > y[i+1]).
 */
export function detectLocalExtrema(points: DiscreteWaterLevelPoint[]): ExtremaPoint[] {
  if (points.length < 3) {
    return [];
  }

  // Ensure chronological order
  const sorted = [...points].sort((a, b) => a.timeMs - b.timeMs);
  const extrema: ExtremaPoint[] = [];

  for (let i = 1; i < sorted.length - 1; i++) {
    const prev = sorted[i - 1].heightMeters;
    const curr = sorted[i].heightMeters;
    const next = sorted[i + 1].heightMeters;

    if (curr > prev && curr >= next) {
      extrema.push({
        type: 'High',
        timestampUtc: sorted[i].timestampUtc,
        timeMs: sorted[i].timeMs,
        heightMeters: curr,
      });
    } else if (curr < prev && curr <= next) {
      extrema.push({
        type: 'Low',
        timestampUtc: sorted[i].timestampUtc,
        timeMs: sorted[i].timeMs,
        heightMeters: curr,
      });
    }
  }

  return extrema;
}

/**
 * Matches observed tidal peaks with predicted tidal peaks within a temporal window (e.g. ±180 minutes).
 * Computes height error and timing error for high and low tides.
 */
export function calculatePeakValidationMetrics(
  observedPoints: DiscreteWaterLevelPoint[],
  predictedPoints: DiscreteWaterLevelPoint[],
  maxMatchingWindowMinutes = 180
): PeakValidationMetrics {
  const observedExtrema = detectLocalExtrema(observedPoints);
  const predictedExtrema = detectLocalExtrema(predictedPoints);

  const matchedPeaks: MatchedTidalPeak[] = [];
  const maxWindowMs = maxMatchingWindowMinutes * 60 * 1000;

  let highMatchedCount = 0;
  let lowMatchedCount = 0;

  const usedPredictedIndices = new Set<number>();

  for (const obs of observedExtrema) {
    let bestPredIndex = -1;
    let minTimeDiffMs = Infinity;

    for (let j = 0; j < predictedExtrema.length; j++) {
      if (usedPredictedIndices.has(j)) continue;

      const pred = predictedExtrema[j];
      if (pred.type !== obs.type) continue;

      const timeDiffMs = Math.abs(pred.timeMs - obs.timeMs);
      if (timeDiffMs <= maxWindowMs && timeDiffMs < minTimeDiffMs) {
        minTimeDiffMs = timeDiffMs;
        bestPredIndex = j;
      }
    }

    if (bestPredIndex !== -1) {
      usedPredictedIndices.add(bestPredIndex);
      const matchedPred = predictedExtrema[bestPredIndex];

      const heightError = matchedPred.heightMeters - obs.heightMeters;
      const timingErrorMinutes = (matchedPred.timeMs - obs.timeMs) / (60 * 1000);

      if (obs.type === 'High') highMatchedCount++;
      if (obs.type === 'Low') lowMatchedCount++;

      matchedPeaks.push({
        type: obs.type,
        observedTimeUtc: obs.timestampUtc,
        observedHeightMeters: obs.heightMeters,
        predictedTimeUtc: matchedPred.timestampUtc,
        predictedHeightMeters: matchedPred.heightMeters,
        heightErrorMeters: Math.round(heightError * 10000) / 10000,
        timingErrorMinutes: Math.round(timingErrorMinutes * 100) / 100,
      });
    }
  }

  if (matchedPeaks.length === 0) {
    return {
      totalPeaksDetected: observedExtrema.length,
      highTidePeaksMatched: 0,
      lowTidePeaksMatched: 0,
      meanPeakHeightErrorMeters: 0,
      peakHeightRmseMeters: 0,
      meanPeakTimingErrorMinutes: 0,
      peakTimingRmseMinutes: 0,
      matchedPeaks: [],
    };
  }

  const n = matchedPeaks.length;
  let sumHeightError = 0;
  let sumHeightSqError = 0;
  let sumTimingError = 0;
  let sumTimingSqError = 0;

  for (const peak of matchedPeaks) {
    sumHeightError += peak.heightErrorMeters;
    sumHeightSqError += peak.heightErrorMeters * peak.heightErrorMeters;
    sumTimingError += peak.timingErrorMinutes;
    sumTimingSqError += peak.timingErrorMinutes * peak.timingErrorMinutes;
  }

  const meanHeightError = sumHeightError / n;
  const heightRmse = Math.sqrt(sumHeightSqError / n);
  const meanTimingError = sumTimingError / n;
  const timingRmse = Math.sqrt(sumTimingSqError / n);

  return {
    totalPeaksDetected: observedExtrema.length,
    highTidePeaksMatched: highMatchedCount,
    lowTidePeaksMatched: lowMatchedCount,
    meanPeakHeightErrorMeters: Math.round(meanHeightError * 10000) / 10000,
    peakHeightRmseMeters: Math.round(heightRmse * 10000) / 10000,
    meanPeakTimingErrorMinutes: Math.round(meanTimingError * 100) / 100,
    peakTimingRmseMinutes: Math.round(timingRmse * 100) / 100,
    matchedPeaks,
  };
}
