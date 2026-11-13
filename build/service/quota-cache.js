export const QUOTA_TTL_MS = 60_000;
function messageOf(error) {
    if (error instanceof Error && error.message.trim().length > 0)
        return error.message;
    return '未知错误';
}
export function createQuotaCache(options) {
    const ttlMs = options.ttlMs ?? QUOTA_TTL_MS;
    const now = options.now ?? Date.now;
    let last = null;
    let inflight = null;
    const success = (items, at, stale, error) => ({
        items,
        readAt: at,
        error,
        stale,
    });
    async function loadOnce() {
        try {
            const items = await options.load();
            const at = now();
            last = { items, at };
            return success(items, at, false, null);
        }
        catch (error) {
            if (last !== null)
                return success(last.items, last.at, true, messageOf(error));
            return { items: null, readAt: null, error: messageOf(error), stale: false };
        }
    }
    return {
        read() {
            if (last !== null && now() - last.at < ttlMs) {
                return Promise.resolve(success(last.items, last.at, false, null));
            }
            if (inflight !== null)
                return inflight;
            inflight = loadOnce().finally(() => {
                inflight = null;
            });
            return inflight;
        },
        peek() {
            return last === null ? null : success(last.items, last.at, false, null);
        },
    };
}
