import { dirname, isAbsolute, join } from 'node:path';
import { parseJsonc } from './jsonc.js';
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}
function text(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
export function gatewayRoot(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}
function configPaths(env, directory) {
    const vars = env.vars ?? {};
    const configHome = vars.XDG_CONFIG_HOME ?? env.xdgConfigHome ?? join(env.home, '.config');
    const configDir = vars.OPENCODE_CONFIG_DIR ?? join(configHome, 'opencode');
    const paths = [join(configDir, 'opencode.jsonc'), join(configDir, 'opencode.json')];
    if (directory !== null && (isAbsolute(directory) || /^[A-Za-z]:[\\/]/.test(directory))) {
        paths.push(join(directory, 'opencode.jsonc'), join(directory, 'opencode.json'), join(directory, '.opencode', 'opencode.jsonc'), join(directory, '.opencode', 'opencode.json'));
    }
    const custom = text(vars.OPENCODE_CONFIG);
    if (custom !== null) {
        paths.push(custom);
    }
    else {
        paths.push(join(env.home, '.config', 'openchamber', 'opencode.managed.jsonc'), join(env.home, '.config', 'openchamber', 'opencode.managed.json'));
    }
    return paths;
}
function authPaths(env) {
    const vars = env.vars ?? {};
    const dataHome = vars.XDG_DATA_HOME ?? env.xdgDataHome ?? join(env.home, '.local', 'share');
    const paths = [join(dataHome, 'opencode', 'auth.json')];
    if (env.localAppData !== undefined)
        paths.push(join(env.localAppData, 'opencode', 'auth.json'));
    return paths;
}
async function resolveKey(raw, baseDir, deps) {
    if (raw === null)
        return null;
    const vars = deps.env.vars ?? {};
    const envRef = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw);
    if (envRef !== null)
        return text(vars[envRef[1]]);
    const fileRef = /^\{file:(.+)\}$/.exec(raw);
    if (fileRef !== null) {
        const target = fileRef[1].trim();
        const path = target.startsWith('~/')
            ? join(deps.env.home, target.slice(2))
            : isAbsolute(target)
                ? target
                : join(baseDir, target);
        const content = await deps.readText(path);
        return content === null ? null : text(content);
    }
    return raw;
}
function pluginEntryMatches(entry) {
    const pkg = text(entry.package) ?? '';
    return /\bmoris\b/i.test(pkg) && /opencode/i.test(pkg);
}
async function candidateFromConfig(config, baseDir, deps) {
    const candidate = { baseUrl: null, apiKey: null };
    const plugins = Array.isArray(config.plugins) ? config.plugins : [];
    for (const entry of plugins) {
        const item = record(entry);
        if (item === null || !pluginEntryMatches(item))
            continue;
        const options = record(item.options);
        if (options === null)
            continue;
        const baseUrl = text(options.baseUrl) ?? text(options.baseURL);
        const apiKey = await resolveKey(text(options.apiKey), baseDir, deps);
        if (baseUrl !== null)
            candidate.baseUrl = baseUrl;
        if (apiKey !== null)
            candidate.apiKey = apiKey;
    }
    for (const key of ['provider', 'providers']) {
        const map = record(config[key]);
        if (map === null)
            continue;
        const entry = record(map.moris);
        if (entry === null)
            continue;
        const options = record(entry.options);
        const settings = record(entry.settings);
        const baseUrl = text(settings?.baseURL) ?? text(settings?.baseUrl) ?? text(options?.baseURL) ?? text(options?.baseUrl);
        const rawKey = text(settings?.apiKey) ?? text(options?.apiKey);
        const apiKey = await resolveKey(rawKey, baseDir, deps);
        if (baseUrl !== null)
            candidate.baseUrl = baseUrl;
        if (apiKey !== null)
            candidate.apiKey = apiKey;
    }
    return candidate;
}
async function readServiceConfig(deps) {
    const dataDir = text(deps.env.dataDir);
    if (dataDir === null)
        return null;
    const path = join(dataDir, 'config.json');
    const raw = await deps.readText(path);
    if (raw === null)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { ok: false, message: `服务配置无法解析：${path}` };
    }
    const config = record(parsed);
    const baseUrl = text(config?.baseUrl) ?? text(config?.baseURL);
    const apiKey = text(config?.apiKey);
    if (baseUrl === null || apiKey === null) {
        return { ok: false, message: `服务配置缺少 baseUrl 或 apiKey：${path}` };
    }
    return { ok: true, target: { rootUrl: gatewayRoot(baseUrl), apiKey, source: 'service-config' } };
}
async function readAuthKey(deps) {
    for (const path of authPaths(deps.env)) {
        const raw = await deps.readText(path);
        if (raw === null)
            continue;
        try {
            const data = record(JSON.parse(raw));
            const entry = record(data?.moris);
            const key = text(entry?.key);
            if (key !== null)
                return key;
        }
        catch {
            // A broken auth store is not a fatal state for this section.
        }
    }
    return null;
}
/**
 * Find the gateway endpoint and device key.
 *
 * 1. `config.json` in the extension's service data folder (`{baseUrl, apiKey}`).
 * 2. The OpenCode config the user already has: a `moris` provider entry, or
 *    this plugin's entry in `plugins[]` with `options.baseUrl`/`options.apiKey`.
 *    `{env:NAME}` and `{file:path}` references are resolved the way OpenCode
 *    resolves them.
 * 3. `auth.json`'s `moris.key` when the key is not inline.
 *
 * The key is returned to the service only. No frame, row or error body ever
 * carries it.
 */
export async function resolveTarget(directory, deps) {
    const explicit = await readServiceConfig(deps);
    if (explicit !== null)
        return explicit;
    const merged = { baseUrl: null, apiKey: null };
    for (const path of configPaths(deps.env, directory)) {
        const raw = await deps.readText(path);
        if (raw === null)
            continue;
        let config;
        try {
            config = parseJsonc(raw);
        }
        catch {
            return { ok: false, message: `OpenCode 配置无法解析：${path}` };
        }
        const body = record(config);
        if (body === null)
            continue;
        const candidate = await candidateFromConfig(body, dirname(path), deps);
        if (candidate.baseUrl !== null)
            merged.baseUrl = candidate.baseUrl;
        if (candidate.apiKey !== null)
            merged.apiKey = candidate.apiKey;
    }
    if (merged.baseUrl === null) {
        return {
            ok: false,
            message: '未找到 moris 网关配置。请在本扩展服务目录的 config.json 中填写 baseUrl 与 apiKey，或在 OpenCode 中配置 moris 供应商。',
        };
    }
    if (merged.apiKey === null)
        merged.apiKey = await readAuthKey(deps);
    if (merged.apiKey === null) {
        return {
            ok: false,
            message: '已找到 moris 网关地址，但缺少设备密钥。请配置 apiKey（或在 OpenCode auth.json 中保存 moris.key）。',
        };
    }
    return {
        ok: true,
        target: {
            rootUrl: gatewayRoot(merged.baseUrl),
            apiKey: merged.apiKey,
            source: 'opencode-config',
        },
    };
}
