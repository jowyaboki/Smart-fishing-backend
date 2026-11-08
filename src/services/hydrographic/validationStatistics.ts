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
  if (!Array.isArray(pairs)) {
    throw new Error('Input pairs must be an array');
  }

  const n = pairs.length;
  if (n === 0) {
    throw new Error('Cannot calculate statistical metrics for an empty dataset');
  }

  // Pre-validate all input numeric values with Number.isFinite()
  for (let i = 0; i < n; i++) {
    const p = pairs[i];
    if (!p || typeof p !== 'object') {
      throw new Error(`Invalid observation pair at index ${i}`);
    }
    if (
      typeof p.predictedWaterLevelMeters !== 'number' ||
      !Number.isFinite(p.predictedWaterLevelMeters)
    ) {
      throw new Error(`Non-finite predicted water level at index ${i}: ${p.predictedWaterLevelMeters}`);
    }
    if (
      typeof p.observedWaterLevelMeters !== 'number' ||
      !Number.isFinite(p.observedWaterLevelMeters)
    ) {
      throw new Error(`Non-finite observed water level at index ${i}: ${p.observedWaterLevelMeters}`);
    }
  }

  let sumError = 0;
  let sumAbsError = 0;
  let sumSquaredError = 0;
  let maxAbs = -Infinity;
  let minAbs = Infinity;

  const errors: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const p = pairs[i];
    const err = p.predictedWaterLevelMeters - p.observedWaterLevelMeters;
    if (!Number.isFinite(err)) {
      throw new Error(`Non-finite residual calculated at index ${i}`);
    }
    errors[i] = err;

    const absErr = Math.abs(err);
    if (!Number.isFinite(absErr)) {
      throw new Error(`Non-finite absolute residual calculated at index ${i}`);
    }

    const sqErr = err * err;
    if (!Number.isFinite(sqErr) || sqErr > Number.MAX_VALUE) {
      throw new Error(`Arithmetic overflow in squared error calculation at index ${i}`);
    }

    sumError += err;
    sumAbsError += absErr;
    sumSquaredError += sqErr;

    if (!Number.isFinite(sumError) || !Number.isFinite(sumAbsError) || !Number.isFinite(sumSquaredError)) {
      throw new Error(`Arithmetic overflow in running sums accumulation at index ${i}`);
    }

    if (absErr > maxAbs) maxAbs = absErr;
    if (absErr < minAbs) minAbs = absErr;
  }

  const bias = sumError / n;
  const mae = sumAbsError / n;
  const meanSquaredError = sumSquaredError / n;

  if (!Number.isFinite(bias) || !Number.isFinite(mae) || !Number.isFinite(meanSquaredError)) {
    throw new Error('Arithmetic overflow in mean error calculation');
  }

  const rmse = Math.sqrt(meanSquaredError);
  if (!Number.isFinite(rmse)) {
    throw new Error('Arithmetic overflow in RMSE square root calculation');
  }

  // Standard deviation of errors relative to the mean error (bias)
  let sumSquaredDeviation = 0;
  for (let i = 0; i < n; i++) {
    const diff = errors[i] - bias;
    const diffSq = diff * diff;
    if (!Number.isFinite(diffSq)) {
      throw new Error(`Arithmetic overflow in squared deviation at index ${i}`);
    }
    sumSquaredDeviation += diffSq;
    if (!Number.isFinite(sumSquaredDeviation)) {
      throw new Error(`Arithmetic overflow in sum of squared deviations at index ${i}`);
    }
  }

  const standardDeviation = Math.sqrt(sumSquaredDeviation / n);

  if (
    !Number.isFinite(standardDeviation) ||
    !Number.isFinite(maxAbs) ||
    !Number.isFinite(minAbs)
  ) {
    throw new Error('Statistical calculation produced non-finite metric output');
  }

  // Round metrics to 4 decimal places for clean floating point representation
  const roundedBias = Math.round(bias * 10000) / 10000;
  const roundedMae = Math.round(mae * 10000) / 10000;
  const roundedRmse = Math.round(rmse * 10000) / 10000;
  const roundedStdDev = Math.round(standardDeviation * 10000) / 10000;
  const roundedMaxAbs = Math.round(maxAbs * 10000) / 10000;
  const roundedMinAbs = Math.round(minAbs * 10000) / 10000;

  if (
    !Number.isFinite(roundedBias) ||
    !Number.isFinite(roundedMae) ||
    !Number.isFinite(roundedRmse) ||
    !Number.isFinite(roundedStdDev) ||
    !Number.isFinite(roundedMaxAbs) ||
    !Number.isFinite(roundedMinAbs)
  ) {
    throw new Error('Rounding produced non-finite metric output');
  }

  return {
    totalPairs: n,
    biasMeters: roundedBias,
    maeMeters: roundedMae,
    rmseMeters: roundedRmse,
    standardDeviationMeters: roundedStdDev,
    maxAbsoluteErrorMeters: roundedMaxAbs,
    minAbsoluteErrorMeters: roundedMinAbs,
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
 * Validates finite timestamps and heights before processing.
 */
export function detectLocalExtrema(points: DiscreteWaterLevelPoint[]): ExtremaPoint[] {
  if (!Array.isArray(points) || points.length < 3) {
    return [];
  }

  // Filter out any invalid points with non-finite timestamp or height
  const validPoints = points.filter(
    (p) =>
      p &&
      typeof p.timeMs === 'number' &&
      Number.isFinite(p.timeMs) &&
      typeof p.heightMeters === 'number' &&
      Number.isFinite(p.heightMeters) &&
      typeof p.timestampUtc === 'string' &&
      p.timestampUtc.trim().length > 0
  );

  if (validPoints.length < 3) {
    return [];
  }

  // Ensure chronological order
  const sorted = [...validPoints].sort((a, b) => a.timeMs - b.timeMs);
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
  if (!Number.isFinite(maxMatchingWindowMinutes) || maxMatchingWindowMinutes <= 0) {
    throw new Error(`Invalid maxMatchingWindowMinutes: ${maxMatchingWindowMinutes}`);
  }

  if (
    options.medianObsIntervalMinutes !== undefined &&
    (!Number.isFinite(options.medianObsIntervalMinutes) || options.medianObsIntervalMinutes <= 0)
  ) {
    throw new Error(`Invalid medianObsIntervalMinutes: ${options.medianObsIntervalMinutes}`);
  }

  const observedExtrema = detectLocalExtrema(observedPoints);
  const predictedExtrema = detectLocalExtrema(predictedPoints);

  // Compute observed sampling interval if not provided
  let samplingIntervalMinutes = options.medianObsIntervalMinutes ?? 60;
  if (observedPoints && observedPoints.length >= 2 && !options.medianObsIntervalMinutes) {
    const validObs = observedPoints.filter(
      (p) => p && typeof p.timeMs === 'number' && Number.isFinite(p.timeMs)
    );
    if (validObs.length >= 2) {
      const diffs: number[] = [];
      const sortedObs = [...validObs].sort((a, b) => a.timeMs - b.timeMs);
      for (let i = 1; i < Math.min(sortedObs.length, 50); i++) {
        const diffMin = (sortedObs[i].timeMs - sortedObs[i - 1].timeMs) / (60 * 1000);
        if (Number.isFinite(diffMin) && diffMin > 0) {
          diffs.push(diffMin);
        }
      }
      if (diffs.length > 0) {
        diffs.sort((a, b) => a - b);
        samplingIntervalMinutes = diffs[Math.floor(diffs.length / 2)] || 60;
      }
    }
  }

  if (!Number.isFinite(samplingIntervalMinutes) || samplingIntervalMinutes <= 0) {
    samplingIntervalMinutes = 60;
  }

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
      if (Number.isFinite(timeDiffMs) && timeDiffMs <= maxWindowMs && timeDiffMs < minTimeDiffMs) {
        minTimeDiffMs = timeDiffMs;
        bestPredIndex = j;
      }
    }

    if (bestPredIndex !== -1) {
      usedPredictedIndices.add(bestPredIndex);
      const matchedPred = predictedExtrema[bestPredIndex];

      const heightError = matchedPred.heightMeters - obs.heightMeters;
      const timingErrorMinutes = (matchedPred.timeMs - obs.timeMs) / (60 * 1000);

      if (!Number.isFinite(heightError) || !Number.isFinite(timingErrorMinutes)) {
        continue;
      }

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
    const hErr = peak.heightErrorMeters;
    const tErr = peak.timingErrorMinutes;

    if (!Number.isFinite(hErr) || !Number.isFinite(tErr)) {
      throw new Error('Non-finite error in matched peak array');
    }

    const hSq = hErr * hErr;
    const tSq = tErr * tErr;

    if (!Number.isFinite(hSq) || !Number.isFinite(tSq)) {
      throw new Error('Overflow in peak squared error calculation');
    }

    sumHeightError += hErr;
    sumHeightSqError += hSq;
    sumTimingError += tErr;
    sumTimingSqError += tSq;

    if (
      !Number.isFinite(sumHeightError) ||
      !Number.isFinite(sumHeightSqError) ||
      !Number.isFinite(sumTimingError) ||
      !Number.isFinite(sumTimingSqError)
    ) {
      throw new Error('Overflow in peak error sums accumulation');
    }
  }

  const meanHeightError = sumHeightError / n;
  const heightRmse = Math.sqrt(sumHeightSqError / n);
  const meanTimingError = sumTimingError / n;
  const timingRmse = Math.sqrt(sumTimingSqError / n);

  if (
    !Number.isFinite(meanHeightError) ||
    !Number.isFinite(heightRmse) ||
    !Number.isFinite(meanTimingError) ||
    !Number.isFinite(timingRmse)
  ) {
    throw new Error('Non-finite peak validation metric computed');
  }

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
