# 本地 AI Agent 执行手册：InvenTree 库存治理与环境验收
版本：v0.1 / 2026-11-27 · 执行对象：本地 Agent · 生产写入须明确授权

## 0. 任务边界及最终目标
适用于既有 InvenTree 服务、可选反向代理及外部 Agent API；不新增服务、不直接访问或修改数据库、不扫描宿主机、不自动安装工具、不自行修改网络或升级。使用用户提供的地址、Token、Compose 项目路径及明确授权。禁止将密钥、库存导出、内网地址、设备 ID、照片提交至代码库。只读阶段可先执行；版本升级、生产批量写入及任何物理移动须单独批准。未取得凭据/路径/环境时报告阻塞。
目标：保留原有 Part/StockItem/Location ID 与业务引用，统一分类、参数、身份、来源及仓储布局；PWA 与本地 Agent 共用相同 catalog 版本。实际数量按元件、批次、序列号、库位、状态逐项核验，不用总量一致替代逐项核对。只以当前现场快照作为验收基线。

## 1. ENV-01：只读环境检查（先执行）
1. 用户提供 InvenTree URL、只读 API Token、现有部署清单/指定 Compose 目录、目标手机系统、GitHub Pages Origin、AI Gateway 地址及能力文档。禁止遍历 NAS 目录、网络扫端口或自动探测其他设备。
2. 执行包内 `python tools/check_inventree.py --url <用户提供地址>`，交互输入 Token；仅执行固定 GET，不跟随重定向，不记录凭据。保存脱敏的 JSON 输出。根 API 版本/软件版本字段以现场响应为准。核对 UI About 和已授权 Compose 配置中镜像标签、镜像摘要；若版本不一致，记录原因，禁止推断。
3. 读取现场 `/api-doc/` 和 `/api/schema/`（若实际不同，以根 API 链接/文档为准），保存 OpenAPI 快照及 SHA256。核验 GET/POST/PATCH 所需字段、分页、权限、数值单位、附件 link、Metadata 读取和更新、StockLocation structural 与 parent、StockItem transfer。记录每项 method/path/request/response/permissions；此阶段只读不 POST。API schema 版本不是软件版本。
4. 目标 1.7.4（2026-11-24 官方 release notes），1.7.x 文档 API 570，现场值作为实际依据。当前 1.7.4 或后续已验证补丁 → 不升级；较旧版本 → 提供升级计划。<1.0.0 → 必须经 1.0.0 中间版本，按官方版本迁移说明。1.2 参数及 metadata 接口变更、1.6 notes 迁移、1.7 audit 替代 stock tracking；不要用旧接口硬套。1.7.0 包含重要安全修复，优先处理仍受影响版本。
5. 从用户指定部署配置确认数据库版本、持久化目录、插件及兼容性、备份路径、恢复方法。验证镜像标签固定，不采用 latest。仅根据明确指定目录运行只读 `docker compose ps`、`docker compose images` 等；命令需符合实际 NAS 管理方式。不打印含密钥的 compose config/env。
6. 手机安装的 GitHub Pages PWA：用真实目标设备验证系统相机 capture、照片返回、CORS OPTIONS + GET、HTTPS→局域网 HTTP 的浏览器规则；如果 HTTP 失败，记录控制台原因并建议现有 OpenWRT TLS 终止，不要求新增服务。Token 与浏览器跨域是独立问题。仅允许实际 Pages Origin，不使用通配；不把真实 token 写入前端产物。AI Gateway 测试图片、实际网络检索、来源证据与结构化 JSON，测试额度先确认。
交付：`env-report.md`、`api-schema.json/yaml`、`api-capability-matrix.csv`、脱敏探针记录、升级与否建议、设备兼容表。验收：版本有证据、API 契约可追溯、阻塞明确，无生产写入。

## 2. ENV-02：有必要才升级（授权门 G1）
1. 先输出变更计划、影响、停机窗口、当前镜像与目标镜像、数据库/插件兼容、回滚策略。请用户批准后执行。升级前先暂停写入并创建数据库备份 + media + 配置/部署文件 + 插件清单，保存校验和，按用户授权存储；不要把备份传外部。
2. 在隔离恢复实例验证备份可用。对隔离副本执行官方升级步骤及必要中间版本；NAS 具体 compose service 名、命令以实际配置和对应版本官方文档为准，不盲跑。核对健康检查、worker、数据库迁移、插件、登录、API 及抽样图片/附件。升级失败禁止只回退镜像对已升级数据库运行，应恢复匹配版本的数据库/media/config 和镜像。
3. 获得生产升级授权后，在维护窗口执行同样的已验证路径；验证服务、库存逐项快照、附件与 BOM，失败立即停写并按已演练流程恢复。严禁跳过备份或自行修复宿主机。
交付：升级记录、备份 manifest/hash、恢复验证记录、前后快照差异。验收：软件版本符合批准基线，服务与数据均通过，未升级则记录原因。

## 3. MIG-01：全量只读盘点（授权只读后执行）
通过实际 schema 支持的 API 分页导出 Part、Category、ParameterTemplate、分类模板关联、Parameter、ManufacturerPart、SupplierPart、Company、StockItem、StockLocation、附件、metadata、BOM/订单/默认库位等相关引用；保留原 ID、原值、状态、时间和快照时间；分页去重、失败重试有限，不能把部分结果标记为全量。数量用十进制字符串或 Decimal，不经 float；隔离序列化/批次/分配/已消耗库存状态。附件只读链接及元数据，按授权决定是否备份内容。
输出 `snapshot/`、`inventory-baseline.json`（按 Part/StockItem/Location/批次/状态统计）、`category-inventory.csv`、`parameter-inventory.csv`、`location-tree.json`、`reference-inventory.json`。缺失、重复、疑似混装、孤儿、空位置、未知字段单独报告。不要用旧聊天的库存数字作为验收依据。

## 4. STD-01：完成共享 Schema v1.0（G2，冻结前不得写生产模板）
本包 `catalog/electronic-parts.json` 当前为待冻结种子（版本及内容以目录本身和 SHA256SUMS 为准）。先使用 [匿名分类覆盖率工具](CATALOG-COVERAGE.md) 生成本地覆盖率与未映射报告；该工具不证明字段语义或真实快照完整性。用真实快照识别所有类别（含 MCU/连接器/模块/传感器/保护件等）；参照 LCSC 类别筛选、商品详情/合法 API 与原厂 datasheet。保存每个类别的来源 URL、观察日期、字段标签、单位/类型、别名、适用条件、原始文本。禁止抓取未经许可数据或猜测类别字段。
稳定字段 key 不随语言变化；同名不同语义须拆分（电阻 TCR vs MLCC X7R）；额定与测量分开；保留不对称容差、范围、测试条件、封装公英制。字段可未知：null + 状态，不用 0、N/A 或常见值替代。字段角色 identity/search/description 可重叠。精确身份=经核验制造商+完整 MPN 或可核验供应商+SKU；冲突阻断。Generic 必须类别明确批准完整身份字段且均已知，默认关闭；Partial 独立来源组，不自动归并。型号后缀不可丢失。统一规格指纹仅用于候选，不替代 Part ID 或 IPN。
交付：catalog v1.0、变更日志、JSON schema、字段映射及证据、覆盖率报告、正反测试样例；用户/项目负责人冻结版本和 SHA256 后 PWA 与整改脚本共用。未分类/未覆盖项目列为阻塞或保持 Partial，不得自行宣称标准全量完成。

## 5. MIG-02：分类与参数模板映射（G3）
按稳定类别 key 对照已有 category ID，区分复用、创建、重命名、移动、冲突。参数对照 key、语义、单位、类型、choices、模型类型和模板 ID；不同单位仅在确切可逆转换时复用。生成 `category-map.csv`、`parameter-map.csv`、`schema-sync-plan.json`（逐项操作、旧值、新值、证据、影响 ID、依赖、逆操作/恢复方式）。不要覆盖已有模板语义，不删除旧模板，不重复创建同义字段；保留历史原始字段值。用户批准后先在隔离测试实例建立模板及分类关联，读回验证，之后才执行生产批准计划。将 backend instance ID、schema hash、category/template ID mapping 保存到适配层配置/支持的 metadata 命名空间；多设备读取一致，不能依赖浏览器单机缓存。

## 6. MIG-03：逐元件资料治理与身份识别（G4）
按类别模板生成草稿：名称、描述、型号、供应商 SKU、参数、原始证据、图片/商品 URL、Datasheet URL、identity mode、sourceGroupId。原厂优先，LCSC/可信分销商次之；精确料号必须和链接页面型号一致；只保存真实链接，不下载 PDF，不生成假图片。包装文字、用户声明、测量分别记录。缺失值为空；不将测得容值推成额定容差、耐压或介质。历史仅知阻值/容值/耐压时允许 Partial，维持独立 Part 与独立最小格子，默认参与宽松搜索，未知不能满足严格约束。
生成 `part-review.csv`、`duplicates.csv`、`conflicts.csv`、`unknowns.csv`、`source-evidence.jsonl`。按 exact/generic/partial 分类；发现同一 Part 疑似混装或多个 Part 疑似重复时只标记，禁止自动合并、删除、改 IPN。证据不足且实物不可辨时维持原记录与待确认标志，不能凭软件拆分实物。批量审阅先选 10~20 个样本，覆盖已知/未知/冲突，然后用户批准批次计划。仅 PATCH 目标字段，写前重新读原值，发现并发修改则停止该条；任何库存数量变化均独立审批。

## 7. MIG-04：物理仓储治理（G5）
仓储结构：Workspace → Cabinet → 可选 Layer → Drawer → 可选 Compartment。最小叶库位可存库存；结构节点不可直接存放。真实柜子行、列、层、可拆隔板及坐标由用户/照片/标签确认。先输出 `physical-layout-questionnaire.csv` 与原库位树，不能凭编号猜实物位置。稳定内部引用保持原 ID，显示名独立；编号建议柜前缀+连续号或层行列，子格以 -1/-2 等后缀。扩容保留既有坐标与编号，新格新增；不因列数改变重新编号。原有 20/实际100 是补齐缺失 80，不移动已有库存。
迁移：一对一绑定旧 ID→新坐标；冲突、未匹配、重复名称单列。优先 PATCH name/parent 保留 ID；创建缺失节点，metadata 使用 `smart_inventory` 命名空间合并写入（不覆盖其他数据），记录 schema/layout revision 和后端引用。若有库存的抽屉拆成子格，先建目标，按用户实物分配逐 StockItem transfer，数量守恒、批次/序列状态不变；转移完成验证后再调整结构标志和布局；旧位置有引用则保留并标记。合并相邻隔板时一 Part/叶规则仍生效；多 Part 须先移其他位置或明确物理独立包装并另行批准规则变更，不允许默认混装。Partial 来源不同不可混放。任何实际分拣由用户确认，不能用数据库操作代替。
交付 `warehouse-map.csv`（old_id,old_path,new_parent,layer,row,col,compartment,new_name,physical_verified）、`layout.json`、`warehouse-plan.json`、`physical-actions.md`（每一步要拿哪包、放哪格、数量、核对项），确认后执行；不删除旧有空库位直到引用核验且单独获批。

## 8. MIG-05：执行日志、异常恢复、最终验收（G6）
每次变更生成 plan ID、snapshot hash、schema hash、目标实例、操作列表/依赖、审批记录；逐项 journal: planned→approved→sent→verified / unknown / blocked。超时后先读回核对对象 ID/值/数量/审计日志，禁止盲目重复 POST 或 transfer。429 限时退避；401/403 停止并报告；409/冲突重读，审批过期需重新批准；部分失败保存已完成项，恢复从已验证 checkpoint 开始。无服务端事务时不承诺全局原子性。备份恢复用于明确批准的全局回滚，不能覆盖并发新业务；可逆字段先用前值修复。按批次执行并核对。交付 `execution-journal.jsonl`、`before-after-diff.json`、`acceptance.md`、`manual-actions.md`、未解决事项。

## 9. 验收清单（全部提供证据，未执行不得写通过）
| ID | 验收 | 证据 |
|---|---|---|
| E01 | 软件版本/镜像/API schema 均有现场证据，升级路径有批准 | env-report, schema hash |
| E02 | 备份恢复测试通过；升级时服务/worker/插件正常 | restore log, health |
| E03 | 真实 iOS/Android 目标设备相机和 API 请求通过，失败原因明确 | 手机截图/日志脱敏 |
| E04 | Agent 视觉、实际检索、JSON、引用链接有效 | 10 个样本结果 |
| S01 | 现有分类覆盖率 100% 或逐项批准未覆盖清单 | coverage report |
| S02 | 共享 catalog hash 一致，映射无歧义、重复字段不新增 | catalog/mapping diff |
| S03 | 单位转换 10kΩ=0.01MΩ，m≠M；未知不变 0 | tests |
| I01 | 5%/1%/0.1% 及不同耐压/封装/介质分开 | identity fixtures |
| I02 | 同 SKU/MPN 冲突阻断，后缀不截断 | tests |
| I03 | Partial 独立来源组，未知字段保留，正常检索 | audit rows |
| I04 | 图片/商品/手册链接准确；未知不臆造 | evidence sample |
| W01 | 库位一对一绑定，原 ID/库存引用保留 | before-after map |
| W02 | 20→100 补齐80，已有坐标编号不变 | layout diff |
| W03 | 拆分合并遵守真实隔板与库存移动规则 | physical checklist |
| W04 | 一 Part/最小格，已知与未知不混装 | occupancy report |
| W05 | 100 件可分 40+60，严格数量守恒 | stock diff |
| D01 | Part、库存、BOM/订单引用无非批准变更 | per-object diff |
| D02 | metadata 命名空间保留其他数据；新设备可恢复布局 | metadata readback |
| D03 | 失败/超时/重复提交无重复建档及重复加库存 | injected failures |
| D04 | 所有写入都有计划、审批、读回验证；无秘密或生产数据进 Git | journal / review |

## 10. 立即可执行任务交接
本地 Agent 先做 ENV-01 和 MIG-01，只读；输出缺失信息和证据，再完成 STD-01 的提案。G1 升级、G2 冻结、G3 模板写入、G4 元件整改、G5 库位迁移、G6 最终验收是不同门禁，不得把用户确认 PWA 架构视为批准生产修改。只剩物理步骤时交付清晰可执行清单，不反复催问；按已批准计划自主推进。不得自行安装、扫描环境、改宿主或不相关配置。

## 参考资料
- Release notes https://docs.inventree.org/en/latest/releases/release_notes/
- API 1.7.x https://docs.inventree.org/en/1.7.x/api/schema/
- Docker https://docs.inventree.org/en/1.7.x/start/docker_install/
- Backup https://docs.inventree.org/en/stable/start/backup/
- Changelog https://github.com/inventree/InvenTree/blob/master/CHANGELOG.md
- Security release https://inventree.org/blog/2026/11/03/1.7.0
- LCSC https://www.lcsc.com/
