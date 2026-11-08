/**
 * In-flight request deduplicator to coalesce identical concurrent operations
 * and eliminate redundant provider hits.
 */
export class RequestDeduplicator {
  private readonly inFlight = new Map<string, Promise<any>>();

  /**
   * Executes or shares an in-flight operation identified by key.
   * If an identical operation is already running, returns the existing promise.
   * Cleans up the registry entry immediately upon completion (success or error).
   */
  public execute<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        return await factory();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Returns the count of operations currently in flight.
   */
  public get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Checks if an operation is currently in flight for a given key.
   */
  public isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Clears the in-flight registry.
   */
  public clear(): void {
    this.inFlight.clear();
  }
}
