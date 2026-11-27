# QA-02 physical PWA acceptance (#24)

Status: not executed. This is a local operator checklist, not browser-fixture or physical-device evidence. Use the existing deployed preview at the approved HTTPS origin and only explicitly authorized read-only InvenTree/AI endpoints. No changes to server configuration, production inventory, or external credentials without separate authorization.

## Record privately before each run

- Installed app version and exact commit from the version status / deployed manifest, date, phone model, OS version, browser/version, installation mode (iOS Home Screen or Android installed PWA).
- Network condition (same LAN / away from LAN / offline), Pages Origin, approved API origin and TLS state, gateway model/capability. Redact URLs if private, tokens, unique device identifiers and photos. Use public component labels only.
- Each case: pass / fail / blocked / not run, observed result and private evidence reference. Do not copy raw HARs, screenshots with secrets or real inventory to GitHub.

## Repeat on both physical systems

| Case | Action | Expected observation |
| --- | --- | --- |
| M01 | Open the deployed preview, install using the native browser, launch from home screen | Installed app opens, correct running version and navigation; not merely a browser tab |
| M02 | Home → 拍照录入 → 拍照, grant camera access, capture a public label, confirm | Returns to the same workflow with selected photo and preview; no upload merely on selection |
| M03 | Repeat camera selection and cancel; select from album and file; remove/reselect a photo | Cancellation preserves prior selection; supported file previews; unsupported/decode error visible, no unintended request |
| M04 | Deny camera permission or select an unsupported/oversized image | No silent success; user can recover through album/file/manual entry or permission settings |
| M05 | Settings → AI Gateway, configure approved values in current session, open photo workflow and explicitly request recognition | Exactly one authorized request, photo included, returned draft presented for review; no automatic inventory write |
| M06 | Verify public label exact MPN, unknown fields, sourced data and links against independent sources; edit an identity/parameter | Review/correction possible; stale field evidence invalidated as appropriate; no claim that URLs prove retrieval |
| M07 | Repeat with cancelled/failed request (use an authorized controlled gateway failure such as 429 or interruption) | Visible failure/cancelled state; no fabricated draft or unnoticed retry; manual entry remains available |
| M08 | Settings → 真实库存只读验证, connect using approved read-only credentials on actual target LAN | Browser completes required preflight/read, actual inventory appears read-only; verify exact Origin and headers privately |
| M09 | Repeat M08 away from LAN or with approved unreachable target; note HTTPS→HTTP, local-network permission, TLS, CORS or auth error separately | No silent success, no unauthorized fallback/scan; diagnose actual browser error, do not disable browser security |
| M10 | Suspend/resume after camera or network interruption; reopen installed app; exercise offline shell | Usable recovery, no repeated write or fabricated read; re-enter session credentials if necessary |
| M11 | Use public label in demo/manual review and correct fields before any simulated commit | Explicit review/confirmation remains; only synthetic inventory changes; real read-only inventory remains unchanged |

For M05–M07 independently run the public photo and text gateway challenges if appropriate, and inspect real gateway retrieval logs/source pages. They do not replace M02–M04 or M08–M10. For M08–M09 do not infer CORS compatibility from curl or a desktop browser. If a browser requires a local-network permission or secure endpoint, record actual prompt/error; do not modify the NAS or router.

## Closeout

Publish only sanitized results per case and platform, exact commit/version, date, and unresolved blockers. Both physical platforms must be exercised; if either device or approved endpoint is unavailable, keep the relevant cases blocked and #24 open. Browser automation can support regression evidence, not physical acceptance. Production writes remain prohibited.
