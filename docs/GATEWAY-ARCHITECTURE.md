# Windows Local Gateway — architecture decision (Epic #161)

Status: owner-approved direction; staged implementation, not yet deployed. This decision supersedes the static-only deployment boundary in ARCHITECTURE.md for live inventory. Existing Pages build stays available during migration as preview/demo; do not advertise live Gateway acceptance until #169.

## Package and ownership

Keep the current repository, `src/` TypeScript core, `web/` React and tests. Add `gateway/` as a separately installable software package. No repository-wide moves or unrelated UI redesign. Reuse existing domain/provider code through explicit server imports; only contracts and pure UI preview algorithms may be shared into the production client. No second inventory database.

- Windows Gateway: HTTPS + same-origin static PWA; versioned API /api/v1; authentication, admin setup, secret/config storage, server-side inventory and AI adapters, authoritative domain validation and approval/execution/reconciliation, persistent SQLite operation journal with CAS/serialization. Inventory remains sole stock authority. AI cannot write stock.
- PWA: camera/photo/barcode, UI, temporary drafts, stable Gateway DTOs/session; no InvenTree/AI addresses, upstream credentials or native API calls. Settings show Gateway and redacted capability/health; authenticated administration configures upstreams on server. Same-origin serving avoids Pages-to-private-network and mixed-content restrictions.
- Existing InvenTree 0.16.7/API 232 primary, 1.7.4/API 570 regression. Keep exact version/schema/actor/catalog/target binding, quantity/identity/physical approvals, readback, no blind replay. Existing HTTPS production upstream gate stays closed for HTTP until a separate reviewed trusted-LAN policy is implemented. TLS client-to-Gateway does not encrypt HTTP upstream. No arbitrary URL proxy, redirects or credential forwarding to unapproved hosts. Upstream allowlist and no AI writes.
- Browser local IndexedDB journals must not be silently replayed or transferred; explicit reconciliation/migration review. Gateway journal durable across restart; stale plan and concurrent client conflicts block safely.

## Windows and TLS

One Windows x64 installable Gateway package, no required Docker, DNS purchase, Caddy, VPN, Apple signing, public inbound port or additional CA server. Initial package uses Node 22 native HTTPS as a minimal dependency-free foundation; API framework and SQLite integration follow #165. Installation distribution must provide pinned supported runtime/crypto tooling, user-selected persistent data path, explicit LAN interface/IP binding and firewall consent, protected Windows ACLs, optional start at login/service, safe upgrade preserving state. No automatic trust-store edits or host scans.

Use mature crypto tooling to generate persistent local root and a short-lived TLS server leaf with exact configured IP/DNS SAN, correct serverAuth and key usage. Persist root/leaf private keys in ACL-protected state, export only public CA certificate/profile. Never silently replace root on corruption or upgrade; explicit recovery with fingerprint verification. Renewal before expiry, atomic replacement and safe reload/restart; changing IP requires leaf reissue, not root change. Root lifetime/rotation documented separately; private CA is powerful, protect its key. iOS first-time profile installation and full trust remain explicit, with SHA-256 fingerprint verified via trusted local channel. No insecure bypass or unauthenticated CA replacement. Onboarding HTTP, if later needed, must expose only public CA and instructions, never secrets, login or business APIs, and be explicitly enabled. Prefer trusted local file transfer.

Foundation only binds loopback, requires operator-provided TLS material; no LAN/business routes or automatic CA yet. #163 implements local CA and renewal; #164 enables explicit LAN deployment after security prerequisites. No automatic root trust installation on CI or host.

## API contract and migration

Versioned /api/v1. Foundation GET /api/v1/health returns only service/api version/status, no upstream details. Subsequent authenticated routes: capabilities, parts, categories, parameters, locations, stock, photo intake/recognition/match, enrichment, operations prepare/approve/execute/reconcile/status; admin connections write-only secrets with redacted GET. Error contract includes stable code, sanitized message, correlation ID; never silently map network errors to empty inventory. Exact request/response schemas and auth added with each vertical slice. No generic reverse proxy. PWA serving/caching must exclude API responses and secrets; no offline stock mutations.

## Acceptance and sequencing

#162 foundation + Windows/Linux TLS smoke; #163 CA lifecycle; #164 Windows package and LAN setup; #165 auth/config/SQLite; #166 inventory; #167 AI; #168 authoritative operations; #169 same-origin PWA end-to-end. #163/#165 parallel after foundation; #164 after CA, LAN exposure requires auth readiness; #166/#167 parallel after auth. Existing #157/#23/#24 remain real-instance/iOS/Android/physical acceptance. Windows GitHub-hosted Runner can prove Windows runtime, packaging, install/start/restart/upgrade/uninstall with synthetic data, certificate chain/SAN and TLS trust using explicit CA, no real system trust changes. It cannot prove user's LAN/firewall, iOS profile installation or real stock/agent access. Existing CI gates unchanged; dedicated Gateway CI adds Windows/Linux. No production writes or environment changes. 
