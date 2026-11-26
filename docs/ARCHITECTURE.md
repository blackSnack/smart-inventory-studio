# Smart Inventory · Studio：业务架构与实施规格 v0.1

## 已确认产品边界
静态 GitHub Pages PWA，React/TypeScript/Vite 目标；已有 AI Gateway + InvenTree API，零新增服务、数据库、实时视频、PDF 下载。HTML Media Capture 系统相机，返回 File 后上传；供应商商品/图片和原厂手册只需要真实链接，产品实拍可上传。库存系统与 AI 分别 Provider 隔离；仅首版实现 InvenTree。首页/元件/仓储/设置四导航；无任务或独立资料补全导航。批量建库放仓储管理菜单；资料补全在元件详情。全局搜索跨仓库，搜索/空/零库存/错误状态独立。用户确认 Studio 风格。

## UI 设计系统
暖白 #F4F2EB、表面 #FFFEF9、墨绿 #293B31、主色 #3E5E4C、鼠尾草 #829B7E、分隔 #DEDFD3、警告 #A47738；4/8px spacing，12/16/24px 圆角，触控目标≥44px，明确 focus、无障碍语义，动画支持 reduced-motion，成功低噪声、失败清晰。正式 React 选 shadcn/ui + Radix + Tailwind + Lucide；TanStack Query/Table，React Hook Form/Zod，Dexie；Motion、dnd-kit 按需要。矩阵用 CSS Grid/SVG，纯算法不耦合 UI。当前 HTML 为无依赖行为原型，未安装这些 React 库，不是正式 PWA。不得将原型的内联事件或 mock 数据直接转为生产逻辑。

## 页面清单与行为
HOME：全局搜索、统计、拍照/手动录入、柜子入口；PART：分类筛选与全局搜索复用 PartCard，显示各库位数量、IPN、身份状态、参数；详情：来源、图片、手册、参数补全、追加库存。SEARCH：后端分页，按 Part 聚合 stock，严格参数过滤排除未知，宽松搜索含 Partial；错误不伪装为空。RECEIVE：初始照片/手动→身份查重→资料审核→数量/库位分配→提交确认，已有元件跳过建档，AI 只给草稿。WAREHOUSE：柜子列表、树/矩阵视图、层切换、物理抽屉详情、创建/扩容/补齐/迁移/子格编辑、批量建库；SETTINGS：Provider URL/token、AI model/key、模板映射、连接检查、编号规则。真实 UI 必须展示未建库位 vs 空库位、部分/未知参数、库存数量不是容量。

## 领域接口与持久化
Domain: Part, Category, ParameterDefinition, IdentityPolicy, PartDraft, StockDistribution, Location, StorageLayout, Drawer/Compartment, OperationPlan. ID 为不透明稳定引用，按 instance namespace 隔离；显示名不参与 ID。库存端口按 parts/categories/parameters/suppliers/documents/locations/stock/metadata/search 分组，方法接受领域对象，返回领域 DTO 而非 InvenTree JSON。能力探测声明分页、创建模板、附件链接、metadata、库存移动、写权限；不支持则明确阻断。AI provider 接受图片/文本+分类模板+schema；结果仅 JSON、逐字段证据、nullable。没有真实检索能力则标明不支持，不生成来源。禁止 AI 获得库存写权限。
Catalog: `catalog/electronic-parts.json` 版本化、LCSC 参考，现仅五类 seed；schema v1.0 冻结是生产门禁。参数 key、单位、类型、证据及 identity roles 独立。精确身份核验制造商+MPN 或供应商+SKU；Generic 默认不合并，Partial 分源；冲突阻断。指纹基于标准化字段与 policy version，不作主键。源数据与测量区分。生产版需扩充 canonical enums、范围/不对称容差、封装公英制、条件化参数和来源核验，当前核心只处理简单 SI 数值与已规范字符串比较。
InvenTree adapter 目标 1.7.4；通过现场 API schema/OPTIONS 校验读写字段和权限。参考路由：/api/part/, /api/part/category/, /api/parameter/template/, /api/parameter/, /api/stock/, /api/stock/location/, /api/stock/transfer/, /api/metadata/{model}/{id}/，分类模板/公司/附件以现场 schema 为准。1.7 audit 代替 stock tracking。当前代码只实现 GET transport 和分页保护，未转换领域 DTO，不能作为生产 adapter。后端负责真实库存；布局和映射放后端 metadata 命名空间，保留其他 metadata；本地 IndexedDB 仅草稿、缓存、journal，按实例隔离。metadata 无法支持的后端明示降级，提供导入导出，不能宣称跨设备同步。

## 写入计划与业务状态
1. Draft → Validated → Reviewed → Approved → Committing → Verified；冲突或超时进入 blocked/unknown，重新读回而非重发。写入之前重新查重、检查目标叶库位、数量及实际容量确认；一个最小库位一 Part；Partial 不同来源独立。库存分配 sum=receipt，正整数（电子元件计数），原位追加/新位/拆分；同 Part 的不同批次不无条件合并。
2. 新建 Part → Manufacturer/Supplier/params/links → StockItem → readback。已有 Part 只入库，不重复建档。失败 checkpoint 可恢复，不承诺跨 REST 原子性。新增前查精确 ID 或已批准的规格匹配；多客户端 race 无服务端唯一约束时无法保证全局防重复，单写者操作窗口，冲突读回，生产需评估服务端约束。
3. 仓储 create/expand/rename/split/merge: 纯布局规划→影响预览→复核库存/引用→批准→创建目标→按实际移动库存→核验数量→修改结构/metadata→清理旧空节点（需审批）。不允许跨不可拆墙、非相邻格合并。扩容保持稳定坐标、ID、旧编号；补齐未建格。旧库位映射人工确认。布局 revision 与并发检查，禁止跨设备静默覆盖。

## 工程阶段 / issue 划分
| ID | 交付 | 验收 |
|---|---|---|
| P0-01 | 环境与 API schema | 现场版本、权限、schema hash、兼容表 |
| P0-02 | 目标手机 Pages/HTTP/AI 接缝 | 相机、CORS、API read、图像+检索 JSON |
| P1-01 | Vite React + Studio tokens + shadcn | 响应式导航、组件复用、无外部后端 |
| P1-02 | 领域 DTO、Provider 接口、InvenTree read adapter | 模拟/隔离实例测试、分页/错误状态 |
| P1-03 | 标准 catalog 与 identity | 真实类别覆盖、冻结 hash、正反例 |
| P2-01 | 全局搜索及详情 | 全库位/零库存/未知/失败区分 |
| P2-02 | 仓储矩阵与创建/补齐 | 坐标、命名、metadata 读回 |
| P2-03 | 拍照与手动共享草稿 | 系统相机与 AI 结构化返回、人工确认 |
| P2-04 | 严格查重和多库位入库 | 规格冲突阻断、数量守恒、读回 |
| P3-01 | 命名迁移/拆分/合并 | 不丢 ID、引用、库存及物理确认 |
| P3-02 | 批量建库/资料补全 | 批量预览、部分失败恢复、来源审查 |
| P3-03 | Pages 安装、缓存、更新、真机验收 | iOS/Android、CORS/TLS、离线仅草稿、敏感数据不缓存 |

独立本地治理线按 LOCAL-AGENT-EXECUTION.md 执行。PWA 基础开发可并行，生产写入必须先环境验证及 schema 冻结。定向测试优先，不擅自安装/改开发环境，不假报完成。

## 当前交付证据与差距
`src/domain.ts`：12 个 Node 单元测试通过，覆盖规范化、身份、分配、扩容和分页同源限制。HTML mock 与核心 TS 分离，UI 目前用内联 JS 模拟；后续 React 应复用核心。UI 隔离 Chromium 用 set_content + mock localStorage：搜索、扩库、均匀拆分、已有元件分配及设置通过；管理员策略阻止 URL 导航，所以不算真实 URL、持久化、PWA 安装或相机验证。没有实际 AI API/库存写入，没有安装 React 依赖。未实现任意矩形局部合并、库存按单条 StockItem 转移、树状视图、批量实际建档、完整参数动态 UI、实际 metadata/图片/链接上传、正式异常恢复；生产阶段须完成。不含真实凭据/数据。
