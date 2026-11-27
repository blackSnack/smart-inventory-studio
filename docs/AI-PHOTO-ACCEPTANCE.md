# Public photo blind challenge (#11, #24)

The existing text challenge is separate. This local CLI invokes the same OpenAICompatibleProvider as the application, using one explicitly approved public-component photograph. It does not exercise browser capture, EXIF removal, resizing or real phone behavior. The caller must prepare a sanitized public JPEG, PNG or WebP (no private labels, inventory, location, EXIF or other metadata; inspect before sending). No network request is made without the explicit flag.

Build in the existing environment with npm run build:core. Keep a private local JSON fixture and photo outside Git. Example fixture (illustrative values, not real source evidence):

```json
{"publicPhotoConfirmed":true,"categoryKeys":["ic.mcu","resistor.smd"],"expected":[{"key":"mpn","value":"FIX-123"},{"key":"category","value":"ic.mcu"},{"key":"parameter:cpu_core","value":"Cortex-M3","sourceUrl":"https://example.test/datasheet"},{"key":"supplier","value":null}]}
```

Use the actual catalog category choices, not a single answer. Supported keys: name, manufacturer, mpn, supplier, sku, category, datasheetUrl, imageUrl, and parameter:<stable_key>. A null expectation requires unknown/absent output; nonnull sourced fields require an independently selected HTTPS source. Use exact expected raw text, not unit normalization. Only the image and category choices are sent; expected values and source URLs remain local. The photo itself is sent to the configured gateway.

Set STUDIO_AI_KEY privately in the current process environment. Run:

```sh
node tools/check-ai-photo.mjs --allow-network <https://gateway/base> <model> <private-fixture.json> <sanitized-photo>
```

Exit 0 = selected candidate checks matched; 2 = candidate mismatch; 1 = invalid input, transport or response failure. Output includes only field keys/statuses, never raw values, image, key or gateway URL. This is not exhaustive draft acceptance: inspect untested fields and independently compare actual sources and private gateway logs. Run separate readable and unreadable public-label fixtures and record source/identity/unknown results. Real gateway retrieval, device capture, cancellation and manual review are still separate acceptance evidence. No production writes, permission changes or live request are included in repository tests.

## Explicit positive and negative acceptance scenarios
For software/real acceptance use `scenario:"legible"` on the fixture: require an exact manufacturer+MPN or supplier+SKU expectation pair and exact `locator` on every nonnull sourced field. For `scenario:"unreadable"`, use a deliberately blank or unreadable public photo, explicitly expect null manufacturer, mpn, supplier, sku, datasheetUrl, imageUrl; all expected values must be null and any invented nonempty parameter or source URL fails. The original selected-fields mode (scenario omitted) remains available for targeted checks but is not complete positive/negative acceptance. Fresh retrieval is tested separately in [AGENT-ACCEPTANCE.md](AGENT-ACCEPTANCE.md).
