# @moris/openchamber-plugin

OpenChamber **Work Status** section for **Moris LLMGateway**. A host-side service reads `/api/quota` and the host draws the section natively — no iframe, no key in a page, and no separate rail panel (the manifest's `panel` object is identity only, with no `entry`).

Shows only:

- supplier balance with its original currency/unit;
- quota windows as percentage and reset time;
- USD quota estimates, labelled as estimates;
- data freshness: ok / unknown / stale / error and the last sample time.

It never renders paid amounts, bills, spend or request history.

Configuration is discovered from the same OpenCode config used by `@moris/opencode-plugin` (`plugins[].options.baseUrl/apiKey`, or a `moris` provider), from `moris.key` in `auth.json`, or from `{OPENCHAMBER_SERVICE_DATA_DIR}/config.json`:

```json
{ "baseUrl": "https://gateway.example.com", "apiKey": "设备密钥" }
```

The service binds `127.0.0.1`, requires the host bearer on every route, caches a successful read for 60 s and shares concurrent reads, so multiple clients do not each hit the gateway.

Build before installing:

```bash
npm run build --workspace=@moris/openchamber-plugin
```

Full behaviour, limitations and verification notes: [`docs/clients.md`](../../docs/clients.md).
