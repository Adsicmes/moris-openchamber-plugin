/**
 * Local mirror of `GET /api/quota` (`QuotaSummary[]` in
 * `packages/contracts/src/index.ts`). Only fields this section renders are
 * modelled; `planPrice`, request costs and bills are deliberately absent.
 */

export type DataState = 'ok' | 'unknown' | 'stale' | 'error' | 'unsupported';

export interface Balance {
  currency: string;
  amount: number;
  unit?: string;
}

export interface QuotaWindow {
  id: string;
  name: string;
  pool: string;
  startsAt: string;
  resetsAt: string;
  usedRatio: number;
  sampledAt: string;
}

export interface ProviderMonitor {
  state: DataState;
  balances: Balance[];
  windows: QuotaWindow[];
  sampledAt: string;
  message?: string;
}

export interface WindowEstimate {
  windowId: string;
  state: 'ok' | 'unavailable';
  totalUsd?: number;
  remainingUsd?: number;
  spentUsd?: number;
  reason?: string;
  sampledAt: string;
  label: string;
}

export interface QuotaSummary {
  accountId: string;
  name: string;
  namespace: string;
  monitor: ProviderMonitor;
  estimates: WindowEstimate[];
}
