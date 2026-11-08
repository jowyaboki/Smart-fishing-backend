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
 * Calculates peak validation metrics by comparing observed peaks and independently detected
 * predicted peaks within a matching tolerance window (e.g. ±180 minutes).
 *
 * Avoids multiple associations (greedy 1-to-1 minimum time difference matching).
 * Calculates height error: predicted - observed
 * Calculates timing error: predictedTime - observedTime (in minutes)
 * Evaluates whether observation sampling resolution allows scientifically defensible timing measurement.
 */
export function calculatePeakValidationMetrics(
  observedPoints: DiscreteWaterLevelPoint[],
  predictedPoints: DiscreteWaterLevelPoint[],
  options: {
    maxMatchingWindowMinutes?: number;
    medianObsIntervalMinutes?: number;
  } = {}
): PeakValidationMetrics {
  const maxMatchingWindowMinutes = options.maxMatchingWindowMinutes ?? 180;
  const observedExtrema = detectLocalExtrema(observedPoints);
  const predictedExtrema = detectLocalExtrema(predictedPoints);

  // Compute observed sampling interval if not provided
  let samplingIntervalMinutes = options.medianObsIntervalMinutes ?? 60;
  if (observedPoints.length >= 2 && !options.medianObsIntervalMinutes) {
    const diffs: number[] = [];
    const sortedObs = [...observedPoints].sort((a, b) => a.timeMs - b.timeMs);
    for (let i = 1; i < Math.min(sortedObs.length, 50); i++) {
      diffs.push((sortedObs[i].timeMs - sortedObs[i - 1].timeMs) / (60 * 1000));
    }
    diffs.sort((a, b) => a - b);
    samplingIntervalMinutes = diffs[Math.floor(diffs.length / 2)] || 60;
  }

  // Scientifically defensible timing resolution:
  // For semi-diurnal tides with gentle curvature near slack water, discrete observation
  // sampling interval must be <= 15 minutes to resolve peak timing within standard hydrographic uncertainty (±10 min).
  // Hourly data (60 min) introduces inherent discretisation uncertainty of up to ±30 minutes.
  const isTimingResolutionScientificallyDefensible = samplingIntervalMinutes <= 15;
  const timingResolutionDisclaimer = isTimingResolutionScientificallyDefensible
    ? undefined
    : `Observation temporal resolution (${samplingIntervalMinutes}m) exceeds recommended threshold (<=15m). Peak timing errors reflect discrete sampling quantization rather than true harmonic model phase divergence.`;

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

  const unmatchedObservedPeaks = observedExtrema.length - matchedPeaks.length;
  const unmatchedPredictedPeaks = predictedExtrema.length - matchedPeaks.length;

  if (matchedPeaks.length === 0) {
    return {
      totalPeaksDetected: observedExtrema.length + predictedExtrema.length,
      observedPeaksDetected: observedExtrema.length,
      predictedPeaksDetected: predictedExtrema.length,
      highTidePeaksMatched: 0,
      lowTidePeaksMatched: 0,
      unmatchedObservedPeaks,
      unmatchedPredictedPeaks,
      meanPeakHeightErrorMeters: 0,
      peakHeightRmseMeters: 0,
      meanPeakTimingErrorMinutes: 0,
      peakTimingRmseMinutes: 0,
      observationSamplingIntervalMinutes: Math.round(samplingIntervalMinutes * 10) / 10,
      isTimingResolutionScientificallyDefensible,
      timingResolutionDisclaimer,
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
    totalPeaksDetected: observedExtrema.length + predictedExtrema.length,
    observedPeaksDetected: observedExtrema.length,
    predictedPeaksDetected: predictedExtrema.length,
    highTidePeaksMatched: highMatchedCount,
    lowTidePeaksMatched: lowMatchedCount,
    unmatchedObservedPeaks,
    unmatchedPredictedPeaks,
    meanPeakHeightErrorMeters: Math.round(meanHeightError * 10000) / 10000,
    peakHeightRmseMeters: Math.round(heightRmse * 10000) / 10000,
    meanPeakTimingErrorMinutes: Math.round(meanTimingError * 100) / 100,
    peakTimingRmseMinutes: Math.round(timingRmse * 100) / 100,
    observationSamplingIntervalMinutes: Math.round(samplingIntervalMinutes * 10) / 10,
    isTimingResolutionScientificallyDefensible,
    timingResolutionDisclaimer,
    matchedPeaks,
  };
}
