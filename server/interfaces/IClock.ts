/**
 * Interface for clock/timer operations.
 * Abstracts setInterval/setTimeout for testability.
 */
export interface IClock {
  /**
   * Starts a repeating interval.
   * @param onTick Callback to run on each tick
   * @param intervalMs Interval in milliseconds
   */
  startInterval(onTick: () => void, intervalMs: number): void;

  /**
   * Stops the current interval.
   */
  stopInterval(): void;

  /**
   * Sets a one-time timeout.
   * @param callback Callback to run when timeout fires
   * @param ms Delay in milliseconds
   * @returns Timer ID that can be used to clear the timeout
   */
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;

  /**
   * Clears a previously set timeout.
   * @param timer Timer ID to clear
   */
  clearTimeout(timer: NodeJS.Timeout): void;
}

/**
 * Production implementation of IClock using real timers.
 */
export class RealClock implements IClock {
  private interval?: NodeJS.Timeout;

  startInterval(onTick: () => void, intervalMs: number): void {
    this.stopInterval();
    this.interval = setInterval(onTick, intervalMs);
  }

  stopInterval(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    return setTimeout(callback, ms);
  }

  clearTimeout(timer: NodeJS.Timeout): void {
    clearTimeout(timer);
  }
}
