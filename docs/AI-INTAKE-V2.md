# AI 智能入库 V2.0 (#159)
用户已批准包装优先、证据融合、库存匹配、字段确认、预填建档、数量及库位审核的完整方案。本分支第一版以现有 provider/执行器为边界，不改变真实库存写入授权。

- 标签提取和资料检索分离；标签文字原样提取，字段必须出现在文字中；不信任模型强制分类，明确分类线索才预填。未知、裸件、多个包装不生成精确身份。原始编码本地解码，未知码不自动请求网址。
- 通过完整制造商/供应商索引匹配，失败不判新。只读仅允许核对/导出；已授权执行复用现有原生审核和恢复。
- 字段级确认绑定当前值，身份变更重置依赖审核，全部确认不替代最终入库批准。包装 QTY 仅为待确认数量。
- 第一版限制：BarcodeDetector 优先并采用锁定版本 ZXing 本地回退；标签局部可读时按模型建议的有效边界从原图裁切复核，冲突置空；仍需实际 iOS/Android 验证。未承诺自动透视矫正、官方供应商 API 或已验证外部检索；自动缺失分类/模板写入不得绕过现有执行能力。真实包装及实际 Gateway 验收需要独立完成。

- LCSC 官方搜索入口：https://www.lcsc.com/search?q=C3019961&type=1；官方授权 API https://www.lcsc.com/docs/openapi/index.html，未配置商户授权，第一版仅使用可点击搜索入口及现有 Gateway 资料建议，不直接调用未授权 API。ZXing 0.21.3 及其依赖锁定；由既有 CI npm ci 核实包完整性，不修改宿主开发环境。

- Packaging examples reviewed: structured LCSC QR envelope (`pc`, `pm`, `qty`) and simple model/package + quantity suffix (`PCS`), including rotated foreground labels. Synthetic regression cases only; original photos, actual customer order numbers and full decoded payloads are not committed. Unmapped category retains literal package; no forced substitution into unrelated categories. Catalog extension remains governed separately.
