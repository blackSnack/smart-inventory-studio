# Agent acceptance (#11)
Software tests use isolated responses. The UI never asserts verified retrieval merely because a model returns URLs. Photo evidence is optional, tied to a nonempty field and listed HTTPS source; editing identity invalidates all photo evidence and editing a field invalidates that field's evidence. 
During the deferred local integration, configure the intended base URL, model and key in Settings; use a public component label with known manufacturer data. Compare returned source pages and exact ratings to the actual datasheet; confirm the gateway performed retrieval using private gateway logs. Repeat with unreadable label, missing source, HTTP 429 and cancellation. Record results privately, not keys/photos/internal inventory in GitHub. Do not enable inventory writes based on model output.

## Optional blind enrichment challenge
After building the existing core with `npm run build:core`, provide an explicitly public component fixture in a private local JSON file (not an inventory export). Example format, with illustrative dummy values only:

```json
{"publicComponentConfirmed":true,"name":"Public component","category":"ic.mcu","manufacturer":"Example maker","mpn":"Example MPN","expected":[{"key":"cpu_core","value":"exact expected raw text","sourceUrl":"https://example.test/actual-source"}]}
```

Set `STUDIO_AI_KEY` privately in the current environment, then explicitly invoke `node tools/check-ai-gateway.mjs --allow-network <https://gateway/base> <model> <private-fixture.json>`. It sends one enrichment request through the real application provider; expected values and source URLs stay local. The report lists only field keys and candidate statuses. Exit 0 means candidate checks matched, 2 means candidate mismatch, 1 means request/config/schema failure. A candidate match does not prove live retrieval: independently inspect source pages and gateway logs; photo/device acceptance is separate. No command is run automatically, no secret or public repository evidence is uploaded. Fixture tests use injected responses, not a real gateway.

## Complete API-03 local acceptance suite
The existing `--allow-network` command is the blind public-component enrichment test. The separate public-photo CLI and fresh-source mode use the same application providers; neither introduces an endpoint, enables inventory writes or changes the Chat Completions protocol.

### Photo recognition: legible and unreadable samples
Use the single public-photo CLI and fixture format documented in [AI-PHOTO-ACCEPTANCE.md](AI-PHOTO-ACCEPTANCE.md). Run explicit legible and unreadable scenarios with independent expected identity, field values and exact source locators. The physical-device checklist is [PHYSICAL-PWA-ACCEPTANCE.md](PHYSICAL-PWA-ACCEPTANCE.md). No actual photo/device acceptance is inferred from synthetic responses.

### Fresh-source retrieval challenge
Use an existing operator-authorized public test page (no new infrastructure required by this application), with a new randomly generated unpredictable token of at least 20 URL-safe characters. Publish the token on the page body under a precise locator, not in the URL or title; record its publication time privately, and make sure it was not supplied in prior prompts, example fixtures or cached content. Use a public test component identity and the private fixture:
```json
{"publicComponentConfirmed":true,"freshPublicSourceConfirmed":true,"name":"Public test component","category":"ic.mcu","manufacturer":"Example maker","mpn":"Example MPN","sourceUrl":"https://example.test/fresh-page","expectedToken":"replace_with_fresh_random_token","expectedLocator":"Retrieval probe"}
```
```sh
node tools/check-ai-gateway.mjs --allow-network-fresh-source <https://gateway/base> <model> <private-fixture.json>
```
The Gateway receives only public identity, URL, and field key `retrieval_probe`; it does not receive expected token or locator. A correct token, exact source URL and locator are necessary candidate checks. Independently confirm the actual page content, time and Gateway retrieval logs (successful fetch of this page during this request, not simply a generated citation). A candidate match still returns `retrievalVerified:false`; the app cannot authenticate private Gateway logs or certify real retrieval from a completion alone. No automatic fetch of model-generated URLs and no arbitrary URL proxy. Failure or unsupported retrieval stays unverified.

### Software exit and runtime handoff
Existing provider contract tests verify exact model/base/key configuration, photo request, review-only result, malformed/incomplete responses, evidence and known-value protection, per-row 429/error isolation and privacy. New tests include cancellation/timeout even for an injected transport or response stream that ignores AbortSignal, rejection of refusal/tool-only output, input bounds and invalid source URLs, blind photo/negative recognition checks, and fresh-source positive/negative checks without revealing answers. Actual Gateway, real public images, fresh page and private logs are required for live acceptance (#22/#23). Record each run and manual verification separately; no actual retrieval or real photo acceptance claimed by CI.
