import { describe, it, expect, vi } from 'vitest';
import { RequestDeduplicator } from '../src/services/marine/cache/requestDeduplicator';
import { MarineService } from '../src/services/marineService';

describe('RequestDeduplicator & Concurrency Control', () => {
  it('deduplicates identical concurrent operations into a single execution', async () => {
    const deduplicator = new RequestDeduplicator();
    let executionCount = 0;

    const factory = () =>
      new Promise<string>((resolve) => {
        executionCount++;
        setTimeout(() => resolve('success-data'), 50);
      });

    // Fire 5 identical requests concurrently
    const [r1, r2, r3, r4, r5] = await Promise.all([
      deduplicator.execute('task-1', factory),
      deduplicator.execute('task-1', factory),
      deduplicator.execute('task-1', factory),
      deduplicator.execute('task-1', factory),
      deduplicator.execute('task-1', factory),
    ]);

    expect(executionCount).toBe(1);
    expect(r1).toBe('success-data');
    expect(r2).toBe('success-data');
    expect(r3).toBe('success-data');
    expect(r4).toBe('success-data');
    expect(r5).toBe('success-data');
    expect(deduplicator.inFlightCount).toBe(0);
  });

  it('executes different concurrent keys independently', async () => {
    const deduplicator = new RequestDeduplicator();
    let countA = 0;
    let countB = 0;

    const factoryA = () =>
      new Promise<string>((resolve) => {
        countA++;
        setTimeout(() => resolve('data-A'), 30);
      });

    const factoryB = () =>
      new Promise<string>((resolve) => {
        countB++;
        setTimeout(() => resolve('data-B'), 30);
      });

    const [resA, resB] = await Promise.all([
      deduplicator.execute('key-A', factoryA),
      deduplicator.execute('key-B', factoryB),
    ]);

    expect(countA).toBe(1);
    expect(countB).toBe(1);
    expect(resA).toBe('data-A');
    expect(resB).toBe('data-B');
    expect(deduplicator.inFlightCount).toBe(0);
  });

  it('cleans up in-flight registry on rejection and propagates error to all callers', async () => {
    const deduplicator = new RequestDeduplicator();
    let executionCount = 0;

    const failingFactory = () =>
      new Promise<string>((_, reject) => {
        executionCount++;
        setTimeout(() => reject(new Error('Network failure')), 30);
      });

    const call1 = deduplicator.execute('fail-task', failingFactory);
    const call2 = deduplicator.execute('fail-task', failingFactory);

    await expect(call1).rejects.toThrow('Network failure');
    await expect(call2).rejects.toThrow('Network failure');

    expect(executionCount).toBe(1);
    expect(deduplicator.inFlightCount).toBe(0);
    expect(deduplicator.isInFlight('fail-task')).toBe(false);

    // Subsequent request should execute again freshly
    let retryRan = false;
    const retryRes = await deduplicator.execute('fail-task', async () => {
      retryRan = true;
      return 'recovered';
    });

    expect(retryRan).toBe(true);
    expect(retryRes).toBe('recovered');
  });

  it('integrates deduplication into MarineService for concurrent calls', async () => {
    MarineService.clearCache();

    // Fire 3 simultaneous getForecast calls for identical coordinates
    const [f1, f2, f3] = await Promise.all([
      MarineService.getForecast({ latitude: 33.58, longitude: -7.61, days: 2 }),
      MarineService.getForecast({ latitude: 33.58, longitude: -7.61, days: 2 }),
      MarineService.getForecast({ latitude: 33.58, longitude: -7.61, days: 2 }),
    ]);

    expect(f1.location.latitude).toBe(33.58);
    expect(f2.location.latitude).toBe(33.58);
    expect(f3.location.latitude).toBe(33.58);
    expect(MarineService.getCacheSize()).toBeGreaterThan(0);
  });
});
