import { timingSafeEqual } from 'node:crypto';
import { resolveTarget } from './config.js';
import { fetchQuota, QuotaError } from './gateway.js';
import { createQuotaCache, QUOTA_TTL_MS } from './quota-cache.js';
import { buildStatusView } from './view.js';
function send(response, status, body) {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
}
function bearerMatches(header, token) {
    if (header === undefined)
        return false;
    const expected = `Bearer ${token}`;
    const left = Buffer.from(header);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}
function safeMessage(error) {
    if (error instanceof QuotaError)
        return error.message;
    if (error instanceof Error && error.message.trim().length > 0)
        return error.message;
    return '服务内部错误';
}
/**
 * The loopback service behind the Work Status section. Every route requires
 * the host-issued bearer, including `/health`. Answers are rows only: the
 * gateway URL and device key never leave this process.
 */
export function createService(deps) {
    const now = deps.now ?? Date.now;
    const timeoutMs = deps.timeoutMs ?? 10_000;
    const env = deps.env;
    const ttlMs = deps.ttlMs ?? QUOTA_TTL_MS;
    /**
     * One cache per `directory` query value. Each load closure captures its
     * own directory, so two projects can never mix config, accounts or quota,
     * and a concurrent load cannot read a mutable "last directory".
     * Bounded LRU so a project-hopping client cannot grow the map forever.
     */
    const caches = new Map();
    const maxCaches = 32;
    function cacheFor(directory) {
        const key = directory ?? '';
        const existing = caches.get(key);
        if (existing !== undefined) {
            // Refresh LRU position.
            caches.delete(key);
            caches.set(key, existing);
            return existing;
        }
        const cache = createQuotaCache({
            ttlMs,
            now,
            load: async () => {
                const target = await resolveTarget(directory, { readText: deps.readText, env });
                if (!target.ok)
                    throw new QuotaError(target.message);
                return fetchQuota({
                    rootUrl: target.target.rootUrl,
                    apiKey: target.target.apiKey,
                    timeoutMs,
                    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
                });
            },
        });
        caches.set(key, cache);
        if (caches.size > maxCaches) {
            const oldest = caches.keys().next().value;
            if (oldest !== undefined)
                caches.delete(oldest);
        }
        return cache;
    }
    return (request, response) => {
        void handle(request)
            .then((answer) => send(response, answer.status, answer.body))
            .catch((error) => {
            console.error('[moris-gateway] unhandled service error:', safeMessage(error));
            send(response, 500, { error: { code: 'internal', message: '服务内部错误' } });
        });
    };
    async function handle(request) {
        if (!bearerMatches(request.headers.authorization, deps.token)) {
            return { status: 401, body: { error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' } } };
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/health') {
            if (request.method !== 'GET')
                return { status: 405, body: { error: { code: 'method', message: 'GET only.' } } };
            return { status: 200, body: { ok: true } };
        }
        if (url.pathname === '/status') {
            if (request.method === 'POST') {
                // No controls are declared, so the host has nothing to post.
                return { status: 405, body: { error: { code: 'method', message: 'This section has no controls.' } } };
            }
            if (request.method !== 'GET')
                return { status: 405, body: { error: { code: 'method', message: 'GET only.' } } };
            const read = await cacheFor(url.searchParams.get('directory')).read();
            const view = buildStatusView({ read, now: now() });
            return { status: 200, body: view };
        }
        return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
    }
}
