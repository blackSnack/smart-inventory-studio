# Gateway package — GW-01 foundation

Node.js 22+; no runtime npm dependencies at this stage. Operator must supply a valid TLS leaf certificate and key (SAN 127.0.0.1 or ::1). Run from this package:

    npm start -- --config config.json

Copy config.example.json to a private config.json and supply TLS material outside source control. Only loopback GET /api/v1/health is available, using HTTPS. It returns Gateway process health, not upstream health. No plaintext listener, LAN exposure, PWA serving, upstream credentials, inventory writes, installer or CA generation yet. Local CA lifecycle and iOS import follow #163, Windows install #164, authenticated services #165–169. Do not disable TLS verification. Never commit private keys or production config. See docs/GATEWAY-ARCHITECTURE.md.

Tests require a pre-provisioned OpenSSL executable (GATEWAY_TEST_OPENSSL path or openssl on PATH), only for ephemeral synthetic fixtures. No trust-store changes. Run npm test. Windows/Linux CI verifies explicit CA TLS, wrong SAN/key and restart; not actual iOS trust.
