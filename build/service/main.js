/**
 * Loopback service for the Moris Gateway Work Status section.
 *
 * The host spawns this file (already compiled JS) with
 * `OPENCHAMBER_SERVICE_PORT`, `OPENCHAMBER_SERVICE_TOKEN` and
 * `OPENCHAMBER_SERVICE_DATA_DIR`. It binds 127.0.0.1 only and requires the
 * bearer on every request. See `@openchamber/sdk` GUEST_SERVICES.md.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { createService } from './app.js';
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT ?? '');
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!Number.isInteger(port) || port <= 0) {
    process.stderr.write('OPENCHAMBER_SERVICE_PORT is missing or invalid\n');
    process.exit(1);
}
if (token.length === 0) {
    process.stderr.write('OPENCHAMBER_SERVICE_TOKEN is missing\n');
    process.exit(1);
}
const server = createServer(createService({
    token,
    readText: async (path) => {
        try {
            return await readFile(path, 'utf8');
        }
        catch {
            return null;
        }
    },
    env: {
        home: homedir(),
        xdgConfigHome: process.env.XDG_CONFIG_HOME,
        xdgDataHome: process.env.XDG_DATA_HOME,
        localAppData: process.env.LOCALAPPDATA,
        dataDir: process.env.OPENCHAMBER_SERVICE_DATA_DIR,
        vars: process.env,
    },
}));
server.on('error', (error) => {
    // Never print configuration values or the bearer.
    process.stderr.write(`moris-gateway service failed: ${error.message}\n`);
    process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`moris-gateway service listening on 127.0.0.1:${port}\n`);
});
const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
