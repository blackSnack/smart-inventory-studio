# Windows Local Gateway

Node.js 22.13+ runtime. The Gateway uses Node's built-in SQLite driver and OpenSSL 3 for certificate generation. Set `tls.opensslPath` when OpenSSL is not on PATH. No public domain, public CA, Docker, Caddy or external certificate service is required.

## Build and first run

From the repository root, install the pinned TypeScript compiler and build the shared domain core:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build:core
```

Then:

1. Copy `gateway/config.example.json` to `gateway/config.json` in a private deployment directory.
2. Set `tls.opensslPath` if OpenSSL 3 is not available as `openssl` on PATH.
3. Run `npm --prefix gateway start -- --config gateway/config.json`.
4. On first start, the Gateway creates a persistent root CA, a short-lived server certificate, a protected SQLite database, a 256-bit encryption key and a one-time administrator setup token file. The path to the setup token file is printed to the console.
5. Export the public CA and iOS profile with `npm --prefix gateway run ca:export -- --config gateway/config.json --out ./gateway-export`. Verify the printed SHA-256 fingerprint over a trusted channel before installing the profile.
6. On iOS, install the profile, then open Settings → General → About → Certificate Trust Settings and explicitly enable full trust for the local CA. Profile installation alone does not enable full trust.

The root CA is persistent for 10 years. Server leaves are valid for 397 days and are renewed automatically when within the configured renewal window. Renewal preserves the root fingerprint. If root certificate/key material is incomplete, corrupt or expired, startup fails closed; it never silently replaces the root CA. Recovery or rotation must be an explicit administrator action.

## Administrator security and persistence

- First-run setup requires the protected `data/setup-token.txt` file and a password of at least 12 characters. The token is removed after setup; if the token file is missing or no longer matches its database hash, the Gateway fails closed instead of issuing a replacement.
- Passwords are stored as salted scrypt hashes. Login attempts are throttled after five failures per client in a 15-minute window.
- Sessions use an HttpOnly, Secure, SameSite=Strict cookie, expire after eight hours and persist across Gateway restarts. State-changing requests require an exact same-origin check and a rotating CSRF token.
- InvenTree and AI credentials are encrypted with AES-256-GCM using a separate 256-bit key in the protected data directory. Admin GET endpoints return only configured flags and redacted metadata; credentials are never read back.
- The SQLite database uses WAL and FULL synchronous durability. Operation journals are scoped by inventory instance, enforce operation-ID uniqueness and single-pending-operation admission, and use revision compare-and-set. A sent operation remains sent across restart and must be reconciled; the Gateway never blindly replays it.
- On Windows, the data directory ACL is restricted to the current account and SYSTEM. On POSIX, the directory is mode 0700 and private files are mode 0600. The CA private key, encryption key and setup token are never served over HTTP.

## Current deployment boundary

This increment still binds loopback only and exposes health, first-run setup, login/session/logout and authenticated upstream configuration endpoints. It does not yet expose LAN, PWA, Inventory/AI provider calls or business operations. Those remain #164, #166–#169 and #171. Upstream URLs must use HTTPS until the separately reviewed private-LAN HTTP policy in #171 is implemented and explicitly enabled.

## Tests

From the repository root, run `npm ci` and `npm run build:core`, then `npm --prefix gateway test`. Tests use synthetic certificates, temporary SQLite databases and synthetic credentials. They never alter Windows, macOS, iOS or Linux trust stores. Windows CI uses the OpenSSL executable bundled with Git for Windows; Linux CI uses the runner OpenSSL.
