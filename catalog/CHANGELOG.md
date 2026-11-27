# Parameter catalog changes

## 0.4.0-draft (2026-11-27)
- Add MCU, male rectangular header and combined environmental sensor candidate categories with 23 new fields; retain every prior key and definition. Public LCSC examples C8734, C158012 and C92489 are linked on categories. Product examples establish candidate field vocabulary, not all category filters or inventory coverage.
- CPU memory/frequency/count labels and sensor ranges retain source text until exact unit and range normalization is separately verified; no guessed conversions or numeric comparisons. Connector pitch reuses pin_spacing; rated current remains existing text. Sensor supply and I/O voltage ranges are distinct. Generic pooling remains disabled, all new categories require review and no template creation is authorized.

## 0.3.0-draft (2026-11-27)
- Retain all original five categories and all 39 field definitions unchanged.
- Add four candidate templates (single diode, Zener, BJT and LDO), 21 field definitions, aliases and semantic annotations. Sources are linked public LCSC product examples; some attributes are available only in indexed excerpts. Template selections are proposed engineering mappings, not an exhaustive LCSC export or verified stock coverage.
- Conditioned values remain strings including test conditions; do not strip conditions or use measured values as ratings. Null remains unknown; generic pooling remains disabled. No private inventory data included.
- SHA-256 records exact catalog bytes; tests verify hash and backward-compatible keys. Freeze to v1.0 requires local anonymized category coverage and approved field/source review; no template creation on production before approval.
