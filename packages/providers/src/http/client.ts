import { ProviderError, type ProviderErrorKind, type ProviderId } from '@omniplay/types';
import { CircuitBreaker, RateLimiter, withRetry } from './resilience.js';

/**
 * The single outbound HTTP path for every provider adapter.
 *
 * Centralising this is what makes spec 13 enforceable rather than aspirational:
 * an adapter cannot accidentally skip the rate limiter or swallow a 429,
 * because it never touches `fetch` directly.
 */

export interface ProviderHttpOptions {
  provider: ProviderId;
  baseUrl?: string;
  /** Sustained request rate. IGDB is 4/sec; Steam is far more forgiving. */
  requestsPerSecond?: number;
  /** Burst allowance above the sustained rate. */
  burst?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  defaultHeaders?: Record<string, string>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  signal?: AbortSignal;
  /** Skip retry for calls that are not safe to repeat. */
  idempotent?: boolean;
}

export class ProviderHttpClient {
  private readonly limiter: RateLimiter;
  readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ProviderHttpOptions) {
    const rps = options.requestsPerSecond ?? 5;
    this.limiter = new RateLimiter(options.burst ?? Math.max(1, Math.ceil(rps)), rps);
    this.breaker = new CircuitBreaker();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  get health(): 'operational' | 'degraded' | 'down' {
    switch (this.breaker.status) {
      case 'closed':
        return 'operational';
      case 'half-open':
        return 'degraded';
      case 'open':
        return 'down';
    }
  }

  async requestJson<T>(options: RequestOptions): Promise<T> {
    const response = await this.request(options);
    const text = await response.text();
    if (!text) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Provider returned an empty body.', {
        provider: this.options.provider,
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ProviderError('MALFORMED_RESPONSE', 'Provider returned invalid JSON.', {
        provider: this.options.provider,
        cause,
      });
    }
  }

  async requestText(options: RequestOptions): Promise<string> {
    return (await this.request(options)).text();
  }

  async request(options: RequestOptions): Promise<Response> {
    const run = async (): Promise<Response> => {
      this.breaker.assertClosed(this.options.provider);
      await this.limiter.acquire();

      const url = this.buildUrl(options);
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout;

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          headers: this.buildHeaders(options),
          body: serialiseBody(options.body),
          signal,
        });
      } catch (cause) {
        // A caller-initiated abort is not a provider fault and must not open
        // the circuit or burn a retry.
        if (options.signal?.aborted) throw cause;

        this.breaker.recordFailure();
        const isTimeout = cause instanceof Error && cause.name === 'TimeoutError';
        throw new ProviderError(
          isTimeout ? 'TIMEOUT' : 'UNAVAILABLE',
          `Request to ${this.options.provider} failed: ${describe(cause)}`,
          { provider: this.options.provider, cause },
        );
      }

      if (!response.ok) {
        const error = await this.toProviderError(response);
        // Only server-side and throttling faults reflect provider health. A 404
        // or a 403 on one private profile says nothing about the service.
        if (error.retryable) this.breaker.recordFailure();
        else this.breaker.recordSuccess();
        throw error;
      }

      this.breaker.recordSuccess();
      return response;
    };

    // Non-idempotent calls still get rate limiting and circuit breaking, just
    // not automatic replay.
    if (options.idempotent === false) return run();

    return withRetry(run, {
      maxAttempts: this.options.maxAttempts ?? 4,
      signal: options.signal,
    });
  }

  private buildUrl(options: RequestOptions): string {
    const url = new URL(
      options.path,
      this.options.baseUrl ?? undefined,
    );
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'OMNIPLAY/0.1 (+https://github.com/omniplay)',
      ...this.options.defaultHeaders,
      ...options.headers,
    };
    if (options.body && typeof options.body !== 'string' && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    return headers;
  }

  private async toProviderError(response: Response): Promise<ProviderError> {
    const kind = statusToKind(response.status);
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // Body already consumed or unreadable; the status alone will do.
    }

    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));

    return new ProviderError(
      kind,
      `${this.options.provider} responded ${response.status}${detail ? `: ${detail}` : ''}`,
      {
        provider: this.options.provider,
        status: response.status,
        ...(retryAfterMs !== null ? { retryAfterMs } : {}),
      },
    );
  }
}

function statusToKind(status: number): ProviderErrorKind {
  if (status === 401) return 'AUTH_EXPIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

/** Retry-After is either delta-seconds or an HTTP date. Both are legal. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function serialiseBody(body: RequestOptions['body']): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
