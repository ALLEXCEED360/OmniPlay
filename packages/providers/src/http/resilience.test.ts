import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@omniplay/types';
import { CircuitBreaker, RateLimiter, backoffDelay, withRetry } from './resilience.js';
import { ProviderHttpClient } from './client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RateLimiter', () => {
  it('serves an initial burst without delay', async () => {
    const limiter = new RateLimiter(3, 3);
    const started = Date.now();
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('makes callers wait once the bucket is drained', async () => {
    // 20/sec means the fourth token is ~50ms away.
    const limiter = new RateLimiter(3, 20);
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);

    const started = Date.now();
    await limiter.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('eventually serves every queued caller', async () => {
    const limiter = new RateLimiter(2, 50);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => limiter.acquire().then(() => i)),
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the event loop alive while callers are queued', async () => {
    // Regression: the drain timer used to be unref'd, so once the bucket
    // emptied nothing held the loop open. A short-lived script would exit
    // cleanly — code 0, no error — having silently dropped every queued
    // request. An unref'd timer is invisible to `getActiveResourcesInfo`.
    const limiter = new RateLimiter(1, 20);
    await limiter.acquire();

    const pending = limiter.acquire();
    expect(process.getActiveResourcesInfo()).toContain('Timeout');

    await pending;
  });
});

describe('CircuitBreaker', () => {
  it('stays closed below the failure threshold', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.status).toBe('closed');
  });

  it('opens once the threshold is reached and refuses calls', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.status).toBe('open');
    expect(() => breaker.assertClosed('steam')).toThrow(ProviderError);
  });

  it('a success resets the failure count', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.status).toBe('closed');
  });

  it('half-opens after the reset timeout and admits exactly one probe', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    breaker.recordFailure();
    expect(breaker.status).toBe('open');

    vi.advanceTimersByTime(1001);
    expect(breaker.status).toBe('half-open');

    // First probe passes; a concurrent second one must not.
    expect(() => breaker.assertClosed('steam')).not.toThrow();
    expect(() => breaker.assertClosed('steam')).toThrow(ProviderError);
  });

  it('a failed probe re-opens the circuit immediately', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 });
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    vi.advanceTimersByTime(1001);
    breaker.assertClosed('steam');
    breaker.recordFailure();

    expect(breaker.status).toBe('open');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and respects the ceiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(backoffDelay(1, 100)).toBe(100);
    expect(backoffDelay(2, 100)).toBe(200);
    expect(backoffDelay(3, 100)).toBe(400);
    expect(backoffDelay(20, 100, 5000)).toBe(5000);
  });

  it('applies jitter so retries do not synchronise', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(backoffDelay(3, 100)).toBe(100);
  });
});

describe('withRetry', () => {
  it('returns the first successful result', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable provider error', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('UNAVAILABLE', 'down', { retryAfterMs: 1 }))
      .mockResolvedValue('recovered');

    await expect(withRetry(operation, { maxAttempts: 3 })).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry an auth failure, which retrying cannot fix', async () => {
    const operation = vi.fn().mockRejectedValue(new ProviderError('AUTH_EXPIRED', 'nope'));
    await expect(withRetry(operation, { maxAttempts: 5 })).rejects.toMatchObject({
      kind: 'AUTH_EXPIRED',
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new ProviderError('RATE_LIMITED', 'slow down', { retryAfterMs: 1 }));

    await expect(withRetry(operation, { maxAttempts: 3 })).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
    });
    expect(operation).toHaveBeenCalledTimes(3);
  });
});

describe('ProviderHttpClient', () => {
  const client = (fetchImpl: typeof fetch, maxAttempts = 1) =>
    new ProviderHttpClient({
      provider: 'steam',
      baseUrl: 'https://example.test/',
      fetchImpl,
      maxAttempts,
      requestsPerSecond: 100,
    });

  it('classifies HTTP statuses into provider error kinds', async () => {
    const cases: Array<[number, string]> = [
      [401, 'AUTH_EXPIRED'],
      [403, 'FORBIDDEN'],
      [429, 'RATE_LIMITED'],
      [503, 'UNAVAILABLE'],
    ];

    for (const [status, kind] of cases) {
      const fetchImpl = vi.fn(async () => new Response('err', { status })) as never;
      await expect(client(fetchImpl).requestJson({ path: 'x' })).rejects.toMatchObject({ kind });
    }
  });

  it('honours a Retry-After header over its own backoff', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('slow', { status: 429, headers: { 'retry-after': '2' } }),
    ) as never;

    await expect(client(fetchImpl).requestJson({ path: 'x' })).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      options: { retryAfterMs: 2000 },
    });
  });

  it('does not count a 404 against provider health', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 })) as never;
    const http = client(fetchImpl);

    for (let i = 0; i < 10; i++) {
      await http.requestJson({ path: 'x' }).catch(() => {});
    }
    // Ten missing resources say nothing about whether Steam is up.
    expect(http.health).toBe('operational');
  });

  it('opens the circuit after repeated server failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as never;
    const http = client(fetchImpl);

    for (let i = 0; i < 6; i++) {
      await http.requestJson({ path: 'x' }).catch(() => {});
    }
    expect(http.health).toBe('down');
  });

  it('rejects a non-JSON body as malformed rather than crashing', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>nope</html>', { status: 200 })) as never;
    await expect(client(fetchImpl).requestJson({ path: 'x' })).rejects.toMatchObject({
      kind: 'MALFORMED_RESPONSE',
    });
  });

  it('appends query parameters and skips null ones', async () => {
    let seen = '';
    const fetchImpl = vi.fn(async (url: string) => {
      seen = String(url);
      return new Response('{}', { status: 200 });
    }) as never;

    await client(fetchImpl).requestJson({
      path: 'path',
      query: { a: 1, b: 'two', c: null, d: undefined, e: false },
    });

    const parsed = new URL(seen);
    expect(parsed.searchParams.get('a')).toBe('1');
    expect(parsed.searchParams.get('b')).toBe('two');
    expect(parsed.searchParams.get('e')).toBe('false');
    expect(parsed.searchParams.has('c')).toBe(false);
    expect(parsed.searchParams.has('d')).toBe(false);
  });
});
