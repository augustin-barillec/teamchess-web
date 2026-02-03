import type { IClock } from "./IClock.js";

interface PendingTimeout {
  callback: () => void;
  triggerTime: number;
}

/**
 * Mock implementation of IClock for testing.
 * Provides manual control over time progression.
 */
export class MockClock implements IClock {
  private tickCallback?: () => void;
  private pendingTimeouts: Map<number, PendingTimeout> = new Map();
  private currentTime = 0;
  private nextTimeoutId = 1;
  private _isIntervalRunning = false;

  /**
   * Whether an interval is currently active.
   */
  get isIntervalRunning(): boolean {
    return this._isIntervalRunning;
  }

  startInterval(onTick: () => void, _intervalMs: number): void {
    this.tickCallback = onTick;
    this._isIntervalRunning = true;
  }

  stopInterval(): void {
    this.tickCallback = undefined;
    this._isIntervalRunning = false;
  }

  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    const id = this.nextTimeoutId++;
    this.pendingTimeouts.set(id, {
      callback,
      triggerTime: this.currentTime + ms,
    });
    return id as unknown as NodeJS.Timeout;
  }

  clearTimeout(timer: NodeJS.Timeout): void {
    this.pendingTimeouts.delete(timer as unknown as number);
  }

  // ========== Test Helpers ==========

  /**
   * Simulates the passage of one or more interval ticks.
   * Each tick advances time by 1000ms and calls the tick callback if set.
   */
  tick(times = 1): void {
    for (let i = 0; i < times; i++) {
      this.currentTime += 1000;
      this.tickCallback?.();
      this.checkTimeouts();
    }
  }

  /**
   * Advances time by a specific amount and triggers any due timeouts.
   */
  advanceTime(ms: number): void {
    this.currentTime += ms;
    this.checkTimeouts();
  }

  /**
   * Gets the current simulated time.
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Gets the number of pending timeouts.
   */
  getPendingTimeoutCount(): number {
    return this.pendingTimeouts.size;
  }

  /**
   * Resets all state for a fresh test.
   */
  reset(): void {
    this.tickCallback = undefined;
    this.pendingTimeouts.clear();
    this.currentTime = 0;
    this.nextTimeoutId = 1;
    this._isIntervalRunning = false;
  }

  private checkTimeouts(): void {
    for (const [id, { callback, triggerTime }] of this.pendingTimeouts) {
      if (triggerTime <= this.currentTime) {
        this.pendingTimeouts.delete(id);
        callback();
      }
    }
  }
}
