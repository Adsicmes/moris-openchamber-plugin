import type { Balance, ProviderMonitor, QuotaSummary, QuotaWindow, WindowEstimate } from './quota.js';

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function number(value: unknown): number | null {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function state(value: unknown): ProviderMonitor['state'] {
  return value === 'ok' || value === 'unknown' || value === 'stale' || value === 'error' || value === 'unsupported'
    ? value
    : 'unknown';
}

function balance(value: unknown): Balance | null {
  const raw = record(value);
  const currency = text(raw?.currency);
  const amount = number(raw?.amount);
  if (currency === null || amount === null) return null;
  const unit = text(raw?.unit);
  return unit === null ? { currency, amount } : { currency, amount, unit };
}

function window(value: unknown): QuotaWindow | null {
  const raw = record(value);
  const id = text(raw?.id);
  const name = text(raw?.name);
  const pool = text(raw?.pool);
  const startsAt = text(raw?.startsAt);
  const resetsAt = text(raw?.resetsAt);
  const usedRatio = number(raw?.usedRatio);
  // `''` is a valid "no sample yet" value from the gateway; keep the window.
  const sampledAt = typeof raw?.sampledAt === 'string' ? raw.sampledAt : '';
  if (id === null || name === null || pool === null || startsAt === null || resetsAt === null) return null;
  if (usedRatio === null) return null;
  return { id, name, pool, startsAt, resetsAt, usedRatio, sampledAt };
}

function estimate(value: unknown): WindowEstimate | null {
  const raw = record(value);
  const windowId = text(raw?.windowId);
  const label = text(raw?.label);
  const sampledAt = text(raw?.sampledAt);
  if (windowId === null || label === null || sampledAt === null) return null;
  const result: WindowEstimate = {
    windowId,
    label,
    sampledAt,
    state: raw?.state === 'ok' ? 'ok' : 'unavailable',
  };
  const total = number(raw?.totalUsd);
  const remaining = number(raw?.remainingUsd);
  const spent = number(raw?.spentUsd);
  const reason = text(raw?.reason);
  if (total !== null) result.totalUsd = total;
  if (remaining !== null) result.remainingUsd = remaining;
  if (spent !== null) result.spentUsd = spent;
  if (reason !== null) result.reason = reason;
  return result;
}

function monitor(value: unknown): ProviderMonitor | null {
  const raw = record(value);
  if (raw === null) return null;
  // A fresh account legitimately reports state "unknown" with `sampledAt: ''`.
  // Keep it so the section can explain the unknown state instead of dropping
  // the whole account.
  const sampledAt = typeof raw.sampledAt === 'string' ? raw.sampledAt : '';
  const balances = Array.isArray(raw.balances)
    ? raw.balances.map(balance).filter((entry): entry is Balance => entry !== null)
    : [];
  const windows = Array.isArray(raw.windows)
    ? raw.windows.map(window).filter((entry): entry is QuotaWindow => entry !== null)
    : [];
  const message = text(raw.message);
  return {
    state: state(raw.state),
    balances,
    windows,
    sampledAt,
    ...(message === null ? {} : { message }),
  };
}

function summary(value: unknown): QuotaSummary | null {
  const raw = record(value);
  const accountId = text(raw?.accountId);
  const name = text(raw?.name);
  const namespace = text(raw?.namespace);
  const view = record(raw?.monitor);
  const providerMonitor = monitor(view);
  if (accountId === null || name === null || namespace === null || providerMonitor === null) return null;
  const estimates = Array.isArray(raw?.estimates)
    ? raw.estimates.map(estimate).filter((entry): entry is WindowEstimate => entry !== null)
    : [];
  return { accountId, name, namespace, monitor: providerMonitor, estimates };
}

/** Parse `{items: QuotaSummary[]}`; malformed accounts are dropped. */
export function normalizeQuota(value: unknown): QuotaSummary[] | null {
  const raw = record(value);
  if (raw === null || !Array.isArray(raw.items)) return null;
  return raw.items.map(summary).filter((entry): entry is QuotaSummary => entry !== null);
}

export interface QuotaFetchOptions {
  rootUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Only safe, human-readable failures leave this function. */
export class QuotaError extends Error {}

function failure(status: number): string {
  if (status === 401 || status === 403) return `网关拒绝了设备密钥（HTTP ${status}）`;
  if (status === 404) return '网关没有 /api/quota 路由（HTTP 404）';
  return `网关额度请求失败（HTTP ${status}）`;
}

export async function fetchQuota(options: QuotaFetchOptions): Promise<QuotaSummary[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(`${options.rootUrl}/api/quota`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${options.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new QuotaError(failure(response.status));
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new QuotaError('网关额度响应不是有效 JSON');
    }
    const items = normalizeQuota(body);
    if (items === null) throw new QuotaError('网关额度响应不符合 QuotaSummary 契约');
    return items;
  } catch (error) {
    if (error instanceof QuotaError) throw error;
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new QuotaError('读取网关超时');
    }
    throw new QuotaError('无法连接网关');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
