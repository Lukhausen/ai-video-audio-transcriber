// Adaptive rate limiter using semaphore + exponential backoff
// Shared across all files to prevent API hammering

export class RateLimiter {
  private queue: Array<() => void> = [];
  private active = 0;
  private maxConcurrent: number;
  private cooldownMs = 0;
  private minCooldownMs = 2000;
  private maxCooldownMs = 120000;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<void> {
    // Apply cooldown if any
    if (this.cooldownMs > 0) {
      await new Promise(r => setTimeout(r, this.cooldownMs));
    }
    // Wait for slot if at capacity
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
  }

  release(): void {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }

  onSuccess(): void {
    // Gradually reduce cooldown on success
    if (this.cooldownMs > 0) {
      this.cooldownMs = Math.max(this.cooldownMs * 0.8, 0);
      if (this.cooldownMs < 500) this.cooldownMs = 0;
    }
  }

  on429(): void {
    // Exponential backoff on rate limit hit
    this.cooldownMs = this.cooldownMs
      ? Math.min(this.cooldownMs * 2, this.maxCooldownMs)
      : this.minCooldownMs;
  }

  get activeCount(): number {
    return this.active;
  }

  get currentCooldown(): number {
    return this.cooldownMs;
  }
}
