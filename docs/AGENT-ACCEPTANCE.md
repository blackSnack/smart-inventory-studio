# Agent acceptance (#11)
Software tests use isolated responses. The UI never asserts verified retrieval merely because a model returns URLs. Photo evidence is optional, tied to a nonempty field and listed HTTPS source; editing identity invalidates all photo evidence and editing a field invalidates that field's evidence. 
During the deferred local integration, configure the intended base URL, model and key in Settings; use a public component label with known manufacturer data. Compare returned source pages and exact ratings to the actual datasheet; confirm the gateway performed retrieval using private gateway logs. Repeat with unreadable label, missing source, HTTP 429 and cancellation. Record results privately, not keys/photos/internal inventory in GitHub. Do not enable inventory writes based on model output.

## Optional blind enrichment challenge
After building the existing core with `npm run build:core`, provide an explicitly public component fixture in a private local JSON file (not an inventory export). Example format, with illustrative dummy values only:

```json
{"publicComponentConfirmed":true,"name":"Public component","category":"ic.mcu","manufacturer":"Example maker","mpn":"Example MPN","expected":[{"key":"cpu_core","value":"exact expected raw text","sourceUrl":"https://example.test/actual-source"}]}
```

Set `STUDIO_AI_KEY` privately in the current environment, then explicitly invoke `node tools/check-ai-gateway.mjs --allow-network <https://gateway/base> <model> <private-fixture.json>`. It sends one enrichment request through the real application provider; expected values and source URLs stay local. The report lists only field keys and candidate statuses. Exit 0 means candidate checks matched, 2 means candidate mismatch, 1 means request/config/schema failure. A candidate match does not prove live retrieval: independently inspect source pages and gateway logs; photo/device acceptance is separate. No command is run automatically, no secret or public repository evidence is uploaded. Fixture tests use injected responses, not a real gateway.
