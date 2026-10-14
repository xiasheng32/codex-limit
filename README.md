# codex-limit

[简体中文](README.md) | [English](README.en.md)

一个 [pi](https://pi.dev) 扩展：在页脚 HUD 显示 **Codex 剩余额度与重置倒计时**，详情保留套餐、重置时间和重置卡明细，支持**仅当前会话的 Fast 模式**，复用 pi 的 `openai-codex` OAuth 登录。

```text
🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)
```

页脚整段沿用默认状态配色，不额外高亮、加粗或添加背景色；低额度、过期缓存、到期、受限或更新中仍使用原有状态颜色，告警阈值不变。

页脚只显示各额度窗口的剩余百分比与括号内的重置倒计时，不显示套餐名或外层括号；套餐仍可在 `/codex-limit` 详情中查看。`(↻3h20m)` 表示距离服务端重置时刻约 3 小时 20 分钟；缺失时间显示 `↻未知`，到点或过去显示 `↻待刷新`，不会自行把额度恢复成 100%。倒计时沿用现有每 60 秒的状态更新及事件刷新，不新增请求或定时器，并非逐秒刷新。重置卡数量、使用记录及重置按钮仍在 `/codex-limit` 详情中查看。套餐及卡片数据以接口返回为准，缺失时明确标为未知，不会默认当成 Plus 或 0 张。不显示订阅到期日，也不推断账单续费日期。

窗口数量和长度以服务端为准，不保证每个账号都有“5 小时 + 7 天”两种窗口。这里不是 OpenAI API 账户余额，也不是当前会话的 token 用量。

## v0.3.0 更新

- 新增唯一 Fast 开关入口 `/fast on`、`/fast off`；新会话默认关闭，同一会话恢复和 `/reload` 保留选择，新建或 fork 会话不继承。
- 仅为 `openai-codex` OAuth 订阅模型的 `openai-codex-responses` 请求设置普通 Fast；其他供应商和普通 OpenAI API 请求不变。
- `/codex-limit` 详情显示当前会话开关、模型和服务端档位；只有服务端确认后，页脚才显示 `· Fast`。切换其他模型后隐藏整条 Codex 状态栏，切回后恢复。
- 页脚图标统一为 `🍧`，同步包入口、两个核心模块和独立自加载副本；没有新增运行时依赖。

## v0.3.1 修复

- 修正 Codex 订阅请求的 Fast 档位值为 `priority`。v0.3.0 使用的 `fast` 被订阅接口拒绝并返回 HTTP 400。

## v0.2.3 更新

- 将包入口统一为 `extensions/index.ts`，同步更新 pi 扩展清单与打包白名单。
- 同步脚本、对应测试及双语文档改用新入口路径；独立自加载副本的输出路径保持不变。
- 入口内容及额度核心逻辑不变，不改变 HUD、查询或重置卡使用行为。

## v0.2.2 更新

- 精简页脚为 `🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)`：移除套餐名及外层括号，每个倒计时单独加括号，窗口间使用单个空格。
- 详情继续显示套餐；过期、更新中、受限提示及颜色阈值保持不变，查询与用卡行为不变。
- 更新页脚格式回归测试，覆盖 Plus、Pro 及未知套餐。

## v0.2.1 更新

- 测试与同步脚本统一为 TypeScript，保留 Node 原生执行，不引入额外 TS 运行器或编译产物。
- 新增 `npm run typecheck` 严格类型检查、`npm run check` 综合验证，以及开发依赖锁定。
- 保留原有 62 项用例，新增 2 项临时目录中的同步脚本测试，共 64 项离线测试。
- 额度查询、手动用卡及界面行为保持不变，无新增运行时依赖。

## v0.2.0 更新

- 新增详情面板 `u` 手动使用重置卡：明确选卡、取消优先确认、账号与卡片复核、单次消费及未决结果防重复保护；不自动消费或重试。
- 页脚新增各额度窗口的重置倒计时，沿用默认状态配色，不自行恢复额度。
- 详情各窗口剩余 ≤20% 时使用淡红进度条；固定重置按钮，精简汇总与重复更新时间。
- 移除 `/codex-limit refresh` 子命令，保留 `/codex-limit` 详情入口、自动查询与安全用卡所需的新鲜查询。

## 安装与试用

需要 Node.js >=22.19 和提供 `modelRegistry.getProviderAuth()`、`before_provider_request`、`provider_stream_event` 的 pi；开发类型与集成测试使用 **1.0.4**；本机 **1.2.0** 已通过离线加载与命令注册验证。运行时由 pi 提供宿主包，无需单独安装运行时依赖；完整离线测试与类型检查需要安装本项目开发依赖。项目自维护代码统一为 TypeScript，由 Node 原生运行，不引入编译产物或额外 TS 运行器；开发类型检查需安装开发依赖。

克隆项目后，在包含 `package.json` 的项目根目录运行（解开 `.tgz` 后则进入 `package/`）：

```bash
cd codex-limit

# 仅本次离线试用，不加载其他扩展、不改配置、不查询凭据或额度
pi --offline -ne -e .

# 仅本次在线试用：交互式启动会查询真实账号
pi -ne -e .

# 确认后安装为常驻扩展（这一步会写入 pi 包配置）
pi install .
```

通过 GitHub 安装：

```bash
pi install git:github.com/xiasheng32/codex-limit
```

已安装 GitHub 包时可更新至仓库最新版本：

```bash
pi update git:github.com/xiasheng32/codex-limit
```

安装或更新后重新启动 pi，或在已有会话中执行 `/reload`。

### 避免重复加载与单文件部署

**包安装与 `~/.pi/agent/extensions/codex-limit.ts` 独立副本只能择一启用**，否则可能重复注册命令、状态栏与查询任务。已存在独立副本时，先通过 `pi config` 禁用旧来源，或备份后移出 autoload 目录；试用命令的 `-ne` 会隔离其他扩展。

`extensions/index.ts` 依赖 `src/quota.ts` 和 `src/fast-mode.ts`，不能单独复制到 autoload 目录。若选择单文件部署，在项目根目录显式运行：

```bash
npm run sync-autoload
# 默认覆盖 ~/.pi/agent/extensions/codex-limit.ts，然后在 pi 中执行 /reload

# 或仅生成指定本地文件，不修改启用中的插件
npm run sync-autoload -- /tmp/codex-limit.ts
```

同步脚本只更新指定的输出文件，不修改其他扩展或配置。修改项目源码不会自动更新已有的独立副本。

> 请审阅源码后自行选择安装方式。离线模式不查询真实账号；在线交互式启动会查询。仓库和本地压缩包不包含任何凭据。

## 登录

在 pi 中执行：

```text
/login openai-codex
```

完成 ChatGPT OAuth 登录。扩展通过 pi 的公开认证接口获取当前 access token；需要续期时由 **pi 自身**处理，扩展不实现第二套 OAuth、不读取 `~/.codex/auth.json`，也不另外保存令牌。

不需要 `.env` 或 API key。普通 `OPENAI_API_KEY`、`openai` provider 的登录以及 Codex CLI 登录均不是本扩展的凭据来源。

## 命令

| 命令 | 功能 |
|---|---|
| `/codex-limit` | 查看额度、重置卡和 Fast 状态；缓存过期且不在退避/冷却期时刷新 |
| `/fast on` | 开启当前会话的普通 Fast，要求当前使用 Codex 订阅 OAuth 模型 |
| `/fast off` | 关闭当前会话的 Fast |

详情采用居中紧凑分区：套餐摘要、剩余额度进度条、重置倒计时、重置卡明细和更新时间。每个窗口独立判断原始剩余比例：**剩余 ≤20%（包括 20% 和 0%）时，该窗口的额度条显示淡红色**，深浅主题使用适配的色调；不会因另一个窗口偏低而误染。仅影响详情进度条，页脚颜色阈值保持不变，过期/受限提示仍保留。日期采用**本机时区**。`u` 进入重置卡使用流程；`Enter`、`Esc` 或 `q` 关闭；窄/矮终端自动换行，必要时用 `↑` / `↓` 滚动，`Home` / `End` 跳至首尾。

重置卡对应 Codex 用量页面的“使用限额重置”，不是付费 Credits 余额。显示服务端的可用张数、卡片类型、有效期，以及接口返回记录中的已用/过期状态和使用时间。**不推断完整历史，不将缺失数据当成 0，不根据累计获得数倒算使用数**；未知状态、有效期和未提供的使用记录会明确标注。扩展不会自动兑换或消耗重置卡。

### 会话内 Fast 模式

只通过 `/fast on` 和 `/fast off` 切换。`/codex-limit` 面板仅查看开关、当前模型、服务端实际档位及消耗说明，没有 Fast 按钮或 `f` 快捷键，也没有 `/fast status`、`/codex-limit fast` 子命令或启动参数。裸 `/fast` 和无效参数仅显示用法，不改变开关、不查询额度。

新会话默认关闭。选择保存为绑定当前 session ID 的自定义会话记录；恢复同一会话或 `/reload` 时恢复选择，不写全局配置，也不向模型上下文加入消息。新建或 fork 会话即使复制了历史记录也默认关闭。保存失败时保留原开关状态。切换模型保留当前会话选择，但清除旧的服务端确认，切回后等待新请求确认。

Fast 仅适用于 **`openai-codex` provider、`openai-codex-responses` API 和 OAuth 订阅认证同时匹配的当前模型**。开启后，扩展通过公开 `before_provider_request` 钩子为匹配模型的请求设置 Codex 订阅接口要求的 `service_tier: "priority"`，保留其他参数；公开 Responses API 的 `fast` 值不能用于这个订阅接口。关闭时不修改请求。切换至其他供应商、普通 `openai` API 或不符合条件的模型后，整条 Codex 状态栏隐藏，不显示 Fast 标记，不更改其请求；切回符合条件的模型后恢复。非 Codex 订阅模型下执行 `/fast on` 会提示先切换模型，原选择不变。

通过公开 `provider_stream_event` 钩子观察服务端完成事件，`fast` / `priority` 表示 Fast 已确认，`default` 表示服务端使用标准档位；缺失或未知档位、失败或不完整响应均显示未确认；前台与后台同模型请求重叠、无法确定响应归属时也显示未确认。发生这种重叠后，本次加载期间保持未确认，结束本轮、关闭再开启或切换模型都不会清除歧义；重新加载或恢复会话后等待新请求确认。无并发的正常请求不受影响。发送 Fast 参数不代表已经加速，扩展不自动重试或降级重发。开关变化不影响已发送的请求。

服务端确认后的页脚示例：

```text
🍧 Codex 额度：5h 78% (↻2h) 7d 64% (↻3d) · Fast
```

| 当前状态 | 页脚后缀 |
|---|---|
| 关闭 | 无后缀 |
| 开启，等待请求确认 | `· Fast待确认` |
| 服务端确认 Fast | `· Fast` |
| 服务端返回标准档位 | `· Fast未生效` |
| 档位缺失、未知、失败/不完整响应或并发归属不明 | `· Fast未确认` |
| 其他供应商或非订阅模型 | 整条 Codex 状态栏隐藏 |

普通 Fast 的订阅额度消耗按标准模式的 **2.5 倍**；可用性取决于模型、账号和服务端。本版不启用 Ultrafast，也未进行真实模型测速，不承诺固定速度提升。[OpenAI 速度说明](https://learn.chatgpt.com/docs/agent-configuration/speed)；宿主接口参考 [pi 公开扩展事件与会话接口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)。

### 手动使用重置卡

**唯一入口是交互式 `/codex-limit` 详情面板底部的重置按钮，按 `u` 激活**；没有消费子命令或模型可调用工具。按钮采用独立分隔区、加粗高亮和背景色，不随明细滚动；显示可用、不可用或处理中状态。不可用时会显示原因，按 `u` 仅提示原因，不进入消费流程。

```text
          [ ↻ 重置额度 · u ]
```

1. 先重新查询额度和卡片明细，再选择具体卡片。只允许合法、唯一 ID 的已知完全重置卡，状态可用且未到期；未提供有效期时明确显示未知，格式异常的有效期不能消费。查询失败、登录失效或冷却期间不能使用旧缓存。
2. 阅读所选卡、当前额度及不可撤销提示。确认页默认选项为 **取消**，只有主动选择“确认使用这张卡”才会发送消费请求；Esc、默认 Enter 或关闭均不消费。
3. 确认后再核对账号和卡片；账号改变、卡片失效或到期则取消，不替换成另一张卡。每次确认最多一次 POST，不自动使用、不自动重试。
4. 明确返回 `reset` 才提示服务端确认重置；`nothing_to_reset`、`no_credit`、`already_redeemed` 分别提示无需重置、无可用卡、已经兑换，不把它们当成本次重置成功。之后重新查询真实额度与卡片，不本地改成 100% 或自行减少卡数；同步失败单独提示并标注过期缓存。流程结束或取消后回到详情面板。

消费请求各 10 秒超时。**请求发出后的断连、超时、5xx 或无法识别的响应可能已消费**：只查询同步，不重发；对应卡在当前实例内保持锁定，仍返回可用/使用中或查询失败不会解锁，直至查询到明确已用/过期状态。已确认消费的卡也不会因暂时返回旧的“可用”记录而被重复使用。未决保护仅存在于内存，**重载/重启会清除锁；结果不明时应先核对官方用量页，不要通过重载重试消费**。消费接口的 429 冷却无法通过刷新绕过。

RPC 模式仅在手动执行命令时查询，结果使用文本通知，不提供消费入口；print/json 无 UI 模式不启用 HUD、查询或消费。离线模式连认证解析都跳过。

## 刷新与状态

- 当前使用 Codex 订阅模型时，交互式会话启动非阻塞查询，每 60 秒和 `agent_settled` 时尝试刷新；自动请求统一至少间隔 30 秒。切换其他模型后停止自动查询并隐藏整条状态栏；手动 `/codex-limit` 仍可查看详情。
- 一次仅有一个刷新请求；每次重新通过 pi 解析认证，不永久缓存 access token。选卡、确认和消费整个流程单飞，期间暂停其他刷新，避免轮询与消费并发覆盖数据。
- 额度与重置卡 HTTP 请求各 10 秒超时。先显示额度，再查询卡片；额度失败后的自动重试从 60 秒起指数退避，最高 5 分钟。卡片查询失败独立退避 60 秒，不影响已成功的额度显示。两种查询的 429 冷却均不能通过反复打开详情或使用重置卡绕过。
- 重置卡明细失败时保留并明确标注过期缓存；`usage` 若提供可用张数，则可作为明细缺失时的摘要。HTTP 404/格式变化不等于没有重置卡。
- 网络/数据错误保留上次成功数据，页脚以 `🍧 Codex[过期] 额度：` 明确标记；这不是当前额度。认证失效、退出登录或账号变化时清空旧数据。
- 未登录显示 `Codex 未登录`；认证、超时、限流和格式问题各有对应提示，详情不会包含原始异常或响应内容。
- 没有主额度窗口显示“暂无主额度数据”，**不代表 0% 或无限额度**。重置时间缺失显示未知，过去的重置时刻显示“待刷新”，不会自行把剩余比例恢复成 100%。
- 会话关闭、切换和重载时清理定时器，取消查询、选卡等待与消费等待并忽略迟到结果；取消本地等待不能撤销已发出的服务端消费。宿主已经开始的 OAuth 续期仍由 pi 自身管理，本扩展的公开认证接口无法取消它。

离线模式会连认证解析一起跳过，打开详情也不会联网：

```bash
pi --offline -ne -e .
# 或 PI_OFFLINE=1 pi -ne -e .
```

`PI_OFFLINE` 支持 `1`、`true`、`yes`（不区分大小写）。更改后重新启动 pi 或 `/reload`。

## 安全与接口限制

- 查询仅向固定的 `https://chatgpt.com/backend-api/wham/usage` 与 `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` 发送 GET；只有详情面板选卡并明确确认后，才向固定的 `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume` 发送一次 POST，JSON 包含所选 `credit_id` 和每次操作生成的 UUID `redeem_request_id`。携带 OAuth Bearer 和账号路由头，拒绝重定向，不允许自定义端点。
- 公开状态仅保留数量、已知状态、类型和时间；卡片 ID、账号关联与防重锁仅保存在控制器私有内存，消费请求 ID 仅用于此次请求，不写入 UI、会话、日志或磁盘。丢弃用户信息、标题、描述等原始字段。
- 只在内存解析 host-issued JWT payload 获取路由账号 ID；**这不是 JWT 签名验证**。
- 不记录 access/refresh token、账号 ID、认证异常原文、完整响应，不把这些内容写入会话或普通日志。
- 扩展依然与 pi 拥有相同的系统权限，请仅加载可信代码。
- 这个接口是 Codex 内部用量接口，**不是稳定的 OpenAI Platform 公共 API**，可能随时变化或拒绝请求。HTTP 401/403 时请在 pi 重新登录；网络或代理异常时检查运行环境。
- 目前显示 `rate_limit` 的主额度窗口；不将模型专属额度、代码审查额度、credits 等其他字段混入主额度。额度足够也不保证模型服务没有容量限制。
- 重置时间仅转述服务端值，不推断固定的每周日历周期或额度恢复承诺。

接口参考：[Codex 查询与消费实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[消费返回码与卡片类型](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs)、[窗口数据模型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs)。

## 开发与离线验证

在项目根目录运行：

```bash
# 仅核心与同步脚本测试，无需安装额外依赖
node --test tests/codex-limit.test.ts tests/fast-mode.test.ts tests/sync-autoload.test.ts

# 完整测试和类型检查：先安装本项目开发依赖
# 不安装插件、不修改全局 pi；不执行依赖安装脚本
npm ci --ignore-scripts --no-audit --no-fund
# 解包后的目录没有 package-lock.json 时，改用 npm install --ignore-scripts --no-audit --no-fund
npm test           # 原生运行 tests/*.test.ts，包含使用 pi 宿主开发依赖的入口集成测试
npm run typecheck  # 严格检查入口、核心、同步脚本与测试，不生成 JS
npm run check      # 类型检查 + 全部离线测试

pi --offline -ne -e . --help
```

完整测试中的入口集成测试使用 pi 宿主开发依赖；类型检查使用 TypeScript、Node 类型及仅供开发的 pi 1.0.4 宿主包；运行时仍由 pi 提供宿主包，不将其加入运行时依赖或捆绑进扩展。`tsconfig.json` 开启严格检查、未使用声明检查及可擦除语法限制；Node 原生运行只擦除类型，不能替代 `npm run typecheck`。

测试保留全部额度/用卡用例，并增加 Fast 请求变换、服务端档位、命令、会话恢复与模型切换测试；覆盖 TS 同步脚本的指定输出与默认输出：这两类同步测试均隔离在临时目录及临时 HOME，不写入真实 Pi 自加载目录。测试仅使用合成 JWT、假认证、假 HTTP 响应、假选择 UI 和可控时间；覆盖比例/窗口/重置解析、确认与取消、指定卡片单次 POST、四种官方返回码、未决锁、账号切换、超时、错误脱敏、节流、单飞、退避、限流和关闭清理；绝不消费真实卡片。帮助命令不查询真实额度，但不能单独证明扩展加载成功，也不验证真实账号访问；离线交互式试用可检查 HUD 与命令是否注册。

如需核对真实数据，可自行运行 `pi -ne -e .`，用 `/codex-limit` 对照 Codex 官方用量页检查剩余比例及重置时刻；这不是离线测试的一部分。

## 本地打包与上传 GitHub

在项目根目录运行：

```bash
npm pack --offline --ignore-scripts --pack-destination ..
# 上一级目录生成 codex-limit-0.3.1.tgz，不安装插件、不发布 npm
```

上传 GitHub 时使用本项目目录的内容，让 `package.json` 位于仓库根目录；不要把整个父目录、`.tgz`、凭据或本机配置上传。源码、测试、README、许可证和 `.gitignore` 均可保留。包清单使用精确文件白名单，不需要 `node_modules/`；压缩包解开后可直接运行上述核心测试和 `pi -ne -e .`；运行完整 `npm test` 或类型检查前，需按开发步骤安装开发依赖。

## 文件结构

```text
codex-limit/
├── extensions/index.ts             # pi 入口、HUD、命令与浮层
├── src/quota.ts                   # 可离线测试的解析、请求和状态机
├── src/fast-mode.ts               # 会话内 Fast 与服务端档位状态
├── tests/codex-limit.test.ts
├── tests/fast-mode.test.ts
├── tests/extension.test.ts         # 命令、会话与模型切换集成验证
├── tests/transport.test.ts         # 真实宿主 HTTP/WebSocket 序列化的离线验证
├── tests/sync-autoload.test.ts    # 临时目录中的同步脚本测试
├── scripts/sync-autoload.ts       # 显式同步 pi 自加载副本
├── tsconfig.json                 # 只做类型检查，不生成 JS
├── package-lock.json             # 仓库开发依赖锁定
├── package.json
├── README.md
├── README.en.md
├── .gitignore
└── LICENSE
```

Pi 通过清单只加载入口文件；`src/` 同时包含在发布文件中。运行时不捆绑 pi 宿主包。

## 许可

[MIT](./LICENSE)
