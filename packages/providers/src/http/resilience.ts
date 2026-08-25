import { ProviderError, type ProviderId } from '@omniplay/types';

/**
 * Rate limiting, retry and circuit breaking for outbound provider calls
 * (spec 13).
 *
 * Every provider gets its own instances. The guarantee we want is that a
 * degraded Xbox cannot slow down or fail a Steam sync, and that OMNIPLAY never
 * becomes the reason a provider rate-limits our whole application.
 */

/* ------------------------------------------------------------------ *
 * Token bucket
 * ------------------------------------------------------------------ */

/**
 * Token-bucket limiter with a FIFO waiter queue.
 *
 * A bucket rather than a fixed window because provider limits are usually
 * expressed as a sustained rate with a burst allowance - IGDB's 4 req/sec is
 * exactly this shape - and a fixed window would either waste the burst or
 * overshoot at the boundary.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = now;
  }

  private scheduleDrain(): void {
    if (this.queue.length === 0) return;
    const msPerToken = 1000 / this.refillPerSecond;

    // Deliberately NOT unref'd. A caller is blocked on this timer, so it must
    // keep the event loop alive: unref'ing it lets a short-lived process exit
    // cleanly the moment the bucket drains, silently abandoning every queued
    // request. Shutdown is handled explicitly by closing workers and by the
    // AbortSignal plumbed through requests, not by starving timers.
    setTimeout(() => {
      this.refill();
      while (this.tokens >= 1 && this.queue.length > 0) {
        this.tokens -= 1;
        this.queue.shift()?.();
      }
      this.scheduleDrain();
    }, Math.max(msPerToken, 10));
  }
}

/* ------------------------------------------------------------------ *
 * Circuit breaker
 * ------------------------------------------------------------------ */

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Stops hammering a provider that is clearly down.
 *
 * Without this, a Steam outage turns every queued sync job into its full retry
 * budget of doomed requests, which delays recovery for everyone and looks like
 * abuse from the provider's side.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private halfOpenInFlight = false;

  constructor(
    private readonly options: {
      failureThreshold?: number;
      /** How long to stay open before probing with one request. */
      resetTimeoutMs?: number;
    } = {},
  ) {}

  private get failureThreshold(): number {
    return this.options.failureThreshold ?? 5;
  }

  private get resetTimeoutMs(): number {
    return this.options.resetTimeoutMs ?? 30_000;
  }

  get status(): CircuitState {
    // Lazily transition to half-open so callers see an accurate state without
    // needing a background timer.
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'half-open';
      this.halfOpenInFlight = false;
    }
    return this.state;
  }

  /** Throws rather than calling through when the circuit is open. */
  assertClosed(provider: ProviderId): void {
    const status = this.status;
    if (status === 'open') {
      throw new ProviderError('UNAVAILABLE', `${provider} is temporarily unavailable.`, {
        provider,
        retryAfterMs: this.resetTimeoutMs - (Date.now() - this.openedAt),
      });
    }
    // In half-open we let exactly one probe through; everything else waits.
    if (status === 'half-open') {
      if (this.halfOpenInFlight) {
        throw new ProviderError('UNAVAILABLE', `${provider} is recovering.`, { provider });
      }
      this.halfOpenInFlight = true;
    }
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenInFlight = false;
  }

  recordFailure(): void {
    this.failures += 1;
    this.halfOpenInFlight = false;
    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Retry
 * ------------------------------------------------------------------ */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration: without it, a worker that fans out 200 games
 * against one provider retries them all in lockstep and reproduces the
 * thundering herd that caused the failure.
 */
export function backoffDelay(attempt: number, baseDelayMs = 500, maxDelayMs = 30_000): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.random() * exponential;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const retryable = error instanceof ProviderError ? error.retryable : false;
      if (!retryable || attempt === maxAttempts) throw error;

      // A provider-supplied Retry-After outranks our own backoff curve.
      const providerDelay =
        error instanceof ProviderError ? error.options.retryAfterMs : undefined;
      const delay = providerDelay ?? backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs);

      await sleep(delay, options.signal);
    }
  }

  throw lastError;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    // Same reasoning as the rate limiter's drain timer: a pending backoff has
    // a caller waiting on it, so it must hold the loop open rather than let
    // the process exit and drop the retry.
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
