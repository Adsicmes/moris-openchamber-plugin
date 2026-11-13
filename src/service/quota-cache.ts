import type { QuotaRead } from './view.js';
import type { QuotaSummary } from './quota.js';

export const QUOTA_TTL_MS = 60_000;

export interface QuotaCacheOptions {
  load: () => Promise<QuotaSummary[]>;
  now?: () => number;
  ttlMs?: number;
}

export interface QuotaCache {
  /**
   * Shared read. A value younger than `ttlMs` is returned without touching the
   * gateway; concurrent callers share one upstream request. A failed read
   * keeps the last successful value and marks it stale, never as zero.
   */
  read: () => Promise<QuotaRead>;
  peek: () => QuotaRead | null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return '未知错误';
}

export function createQuotaCache(options: QuotaCacheOptions): QuotaCache {
  const ttlMs = options.ttlMs ?? QUOTA_TTL_MS;
  const now = options.now ?? Date.now;
  let last: { items: QuotaSummary[]; at: number } | null = null;
  let inflight: Promise<QuotaRead> | null = null;

  const success = (items: QuotaSummary[], at: number, stale: boolean, error: string | null): QuotaRead => ({
    items,
    readAt: at,
    error,
    stale,
  });

  async function loadOnce(): Promise<QuotaRead> {
    try {
      const items = await options.load();
      const at = now();
      last = { items, at };
      return success(items, at, false, null);
    } catch (error) {
      if (last !== null) return success(last.items, last.at, true, messageOf(error));
      return { items: null, readAt: null, error: messageOf(error), stale: false };
    }
  }

  return {
    read(): Promise<QuotaRead> {
      if (last !== null && now() - last.at < ttlMs) {
        return Promise.resolve(success(last.items, last.at, false, null));
      }
      if (inflight !== null) return inflight;
      inflight = loadOnce().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    peek(): QuotaRead | null {
      return last === null ? null : success(last.items, last.at, false, null);
    },
  };
}
