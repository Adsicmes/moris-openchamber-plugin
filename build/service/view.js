export const TIME_ZONE = 'Asia/Shanghai';
/** `DEFAULT_SETTINGS.balanceStaleMs` in packages/contracts. */
export const DEFAULT_STALE_AFTER_MS = 360_000;
const MAX_ROWS = 16;
const NOTE_MAX = 300;
export function redact(text) {
    return text
        .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
        .replace(/(^|\s)(sk-|key-)[A-Za-z0-9_-]{8,}/g, '$1[redacted]')
        .trim();
}
function clampNote(text) {
    const clean = redact(text);
    return clean.length > NOTE_MAX ? `${clean.slice(0, NOTE_MAX - 1)}…` : clean;
}
function safeDate(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}
export function formatTime(ms, timeZone = TIME_ZONE) {
    if (ms === null)
        return '未知';
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone,
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(new Date(ms));
    }
    catch {
        return new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
    }
}
export function formatAmount(amount, currency, unit) {
    if (!Number.isFinite(amount))
        return '—';
    const code = currency.trim().toUpperCase();
    let value;
    try {
        value = new Intl.NumberFormat(code === 'CNY' ? 'zh-CN' : 'en-US', {
            style: 'currency',
            currency: code,
            maximumFractionDigits: 2,
        }).format(amount);
    }
    catch {
        value = `${amount.toFixed(2)} ${currency}`;
    }
    return unit === undefined || unit.length === 0 ? value : `${value} ${unit}`;
}
function stateOf(monitor, now, staleAfterMs, staleRead) {
    const sampled = safeDate(monitor.sampledAt);
    if (staleRead)
        return { state: 'stale', label: '过期', tone: 'warning' };
    switch (monitor.state) {
        case 'ok':
            if (sampled !== null && now - sampled > staleAfterMs) {
                return { state: 'stale', label: '过期', tone: 'warning' };
            }
            return { state: 'ok', label: '正常', tone: 'success' };
        case 'error':
            return { state: 'error', label: '获取失败', tone: 'error' };
        case 'stale':
            return { state: 'stale', label: '过期', tone: 'warning' };
        case 'unsupported':
            return { state: 'unknown', label: '未知', tone: 'muted' };
        default:
            return { state: 'unknown', label: '未知', tone: 'muted' };
    }
}
function ratioTone(ratio) {
    if (ratio >= 0.95)
        return 'error';
    if (ratio >= 0.8)
        return 'warning';
    return 'info';
}
function percentText(ratio) {
    if (!Number.isFinite(ratio))
        return '—';
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    const rounded = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
    return `${rounded}%`;
}
export function windowRow(id, label, window, timeZone) {
    const ratio = Number.isFinite(window.usedRatio) ? window.usedRatio : 0;
    const reset = formatTime(safeDate(window.resetsAt), timeZone);
    return {
        kind: 'line',
        id,
        label,
        content: { kind: 'bar', value: Math.max(0, Math.min(100, ratio * 100)), tone: ratioTone(ratio) },
        value: `${percentText(ratio)} · 重置 ${reset}`,
        tooltip: `${window.name} · 池 ${window.pool} · ${window.startsAt} → ${window.resetsAt}`,
    };
}
function estimateValue(total, remaining) {
    const parts = [];
    if (typeof total === 'number' && Number.isFinite(total))
        parts.push(`总额 $${total.toFixed(2)}`);
    if (typeof remaining === 'number' && Number.isFinite(remaining))
        parts.push(`剩余 $${remaining.toFixed(2)}`);
    return parts.length === 0 ? null : parts.join(' · ');
}
/**
 * Build the Work Status section. Only four things are rendered: balance with
 * its original currency, window percentages and reset times, USD quota
 * estimates, and data freshness. Paid amounts, spend and request history are
 * intentionally not part of this view.
 */
export function buildStatusView(input) {
    const timeZone = input.timeZone ?? TIME_ZONE;
    const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const { read } = input;
    const content = [];
    const accounts = read.items ?? [];
    let worst = read.error === null
        ? null
        : read.items === null
            ? { state: 'error', label: '获取失败', tone: 'error' }
            : { state: 'stale', label: '过期', tone: 'warning' };
    let newestSample = null;
    let stateMessage = null;
    accounts.forEach((account, accountIndex) => {
        const monitor = account.monitor;
        const state = stateOf(monitor, input.now, staleAfterMs, read.stale);
        if (worst === null || state.state === 'error')
            worst = state;
        else if (worst.state === 'ok' && state.state !== 'ok')
            worst = state;
        const sampled = safeDate(monitor.sampledAt);
        if (sampled !== null && (newestSample === null || sampled > newestSample))
            newestSample = sampled;
        if (stateMessage === null && state.state !== 'ok' && typeof monitor.message === 'string' && monitor.message.trim()) {
            stateMessage = monitor.message;
        }
        const prefix = accounts.length > 1 ? `${account.name || account.namespace} · ` : '';
        const firstRowIndex = content.length;
        monitor.balances.forEach((balance, balanceIndex) => {
            content.push({
                kind: 'line',
                id: `balance-${accountIndex}-${balanceIndex}`,
                label: `${prefix}余额 (${balance.currency})`,
                value: formatAmount(balance.amount, balance.currency, balance.unit),
                icon: 'wallet-3',
                tooltip: '供应商账户余额，账户口径，可能包含网关外使用。',
            });
        });
        monitor.windows.forEach((window, windowIndex) => {
            content.push(windowRow(`window-${accountIndex}-${windowIndex}`, `${prefix}${window.name}`, window, timeZone));
        });
        account.estimates.forEach((estimate, estimateIndex) => {
            const value = estimate.state === 'ok' ? estimateValue(estimate.totalUsd, estimate.remainingUsd) : null;
            content.push({
                kind: 'line',
                id: `estimate-${accountIndex}-${estimateIndex}`,
                label: `${prefix}${estimate.label} 估算`,
                value: value ?? '不可用',
                valueTone: value === null ? 'muted' : 'default',
                tooltip: value === null
                    ? redact(estimate.reason ?? '窗口数据不足，无法估算美元等价额度。')
                    : '基于本网关记录的 API 等价消费与窗口比例估算，不是官方额度。',
            });
        });
        if (accounts.length > 1) {
            const first = content[firstRowIndex];
            if (first !== undefined && first.kind === 'line') {
                first.badge = { label: state.label, tone: state.tone };
            }
            else {
                content.push({
                    kind: 'line',
                    id: `account-${accountIndex}`,
                    label: account.name || account.namespace,
                    content: { kind: 'text', text: state.label, tone: state.tone },
                });
            }
        }
    });
    const errorNote = read.error !== null
        ? {
            kind: 'note',
            id: 'read-error',
            text: clampNote(`读取网关失败：${read.error}（稍后会自动重试）`),
            tone: 'error',
        }
        : null;
    const messageNote = stateMessage !== null
        ? {
            kind: 'note',
            id: 'state-message',
            text: clampNote(stateMessage),
            tone: worst?.state === 'error' ? 'error' : 'warning',
        }
        : null;
    const scopeNote = {
        kind: 'note',
        id: 'scope',
        text: '余额为供应商账户口径，可能包含网关外使用；美元额度为基于本网关记录的估算，不是官方额度。',
        tone: 'muted',
    };
    const fixed = 1 + 1 + (errorNote === null ? 0 : 1) + (messageNote === null ? 0 : 1);
    let budget = MAX_ROWS - fixed;
    const truncated = content.length > budget;
    if (truncated)
        budget -= 1;
    const visible = content.slice(0, Math.max(0, budget));
    const rows = [...visible];
    if (truncated) {
        rows.push({
            kind: 'note',
            id: 'truncated',
            text: `仅显示前 ${visible.length} 行，其余额度窗口未在此展开。`,
            tone: 'muted',
        });
    }
    const updateTime = newestSample ?? read.readAt;
    const state = worst ?? { state: 'ok', label: '正常', tone: 'success' };
    rows.push({
        kind: 'line',
        id: 'updated',
        label: '数据更新时间',
        content: { kind: 'text', text: state.label, tone: state.tone },
        value: formatTime(updateTime, timeZone),
        tooltip: read.readAt === null ? '尚无成功的网关读取。' : `本地读取 ${formatTime(read.readAt, timeZone)}。`,
    });
    if (read.items !== null && accounts.length === 0 && read.error === null) {
        rows.push({
            kind: 'note',
            id: 'no-data',
            text: '网关未返回任何账号额度；请确认供应商账号已启用并完成同步。',
            tone: 'warning',
        });
    }
    rows.push(scopeNote);
    if (errorNote !== null)
        rows.push(errorNote);
    if (messageNote !== null)
        rows.push(messageNote);
    return { rows: rows.slice(0, MAX_ROWS) };
}
