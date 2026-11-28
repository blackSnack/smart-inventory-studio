# Windows Local Gateway

Node.js 22+ runtime. The default configuration creates a persistent local root CA and a short-lived TLS server certificate on first start. OpenSSL 3 is required for certificate generation; set `tls.opensslPath` to its executable when it is not on PATH. No public domain, public CA, Docker, Caddy or external certificate service is required.

## First run

1. Copy `config.example.json` to `config.json` in a private deployment directory.
2. Set `tls.opensslPath` if OpenSSL 3 is not available as `openssl` on PATH.
3. Run `npm start -- --config config.json`.
4. The Gateway creates `data/tls/root-ca.crt`, `root-ca.key`, `server.crt` and `server.key`. The root private key is kept in the Gateway data directory; it is never exported.
5. Export the public CA and iOS profile with `npm run ca:export -- --config config.json --out ./export`. Verify the printed SHA-256 fingerprint over a trusted channel before installing the profile.
6. On iOS, install the downloaded profile, then open Settings → General → About → Certificate Trust Settings and explicitly enable full trust for the local CA. Profile installation alone does not enable full trust.

The root CA is persistent for 10 years. Server leaves are valid for 397 days and are renewed automatically when within the configured renewal window. Renewal preserves the root fingerprint. If root certificate/key material is incomplete, corrupt or expired, startup fails closed; it never silently replaces the root CA. Recovery or rotation must be an explicit administrator action.

## Current deployment boundary

This release still binds loopback only and exposes only `GET /api/v1/health`. It does not yet expose LAN, PWA, upstream Inventory/AI services, authentication or stock operations. Those remain #164–#169 and #171. The CA export is suitable for validating the local certificate lifecycle and manual iOS trust workflow; it is not yet the complete phone-to-LAN deployment.

## Tests

Run `npm test`. Tests use synthetic certificates and an explicitly provisioned OpenSSL executable. They never alter Windows, macOS, iOS or Linux trust stores. Windows CI uses the OpenSSL executable bundled with Git for Windows; Linux CI uses the runner OpenSSL.
