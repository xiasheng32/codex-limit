# codex-limit

[简体中文](README.md) | [English](README.en.md)

> 一个 [pi](https://pi.dev) 扩展：在页脚 HUD 显示 **Codex 剩余额度与重置倒计时**，详情含套餐、重置时间与重置卡明细，支持**仅当前会话的 Fast 模式**，复用 pi 的 `openai-codex` OAuth 登录。

```text
🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)
```

## 功能特性

- 页脚只显示各额度窗口的剩余百分比与括号内重置倒计时，不显示套餐名或外层括号。`(↻3h20m)` 表示距服务端重置约 3 小时 20 分钟；缺失时间显示 `↻未知`，到点或过去显示 `↻待刷新`，不会自行把额度恢复成 100%。
- 页脚整段沿用默认状态配色，低额度、过期缓存、到期、受限或更新中使用原有状态颜色与告警阈值；倒计时沿用每 60 秒的状态更新及事件刷新，不新增请求或定时器。
- 详情面板居中紧凑分区：套餐摘要、剩余额度进度条、重置倒计时、重置卡明细和更新时间。各窗口独立判断，剩余 ≤20%（含 20% 和 0%）时该窗口进度条显示淡红。套餐及卡片数据以接口返回为准，缺失时标为未知，不推断账单续费日期。
- 重置卡对应 Codex 用量页的"使用限额重置"，不是付费 Credits；支持详情面板 `u` 键手动用卡，扩展不自动兑换或消耗。
- 会话内 Fast 模式：`/fast on` / `/fast off` 只影响当前会话，按官方模型能力目录为官方订阅模型请求设置 `service_tier`。
- 窗口数量与长度以服务端为准，不保证每个账号都有"5 小时 + 7 天"窗口。这里不是 OpenAI API 账户余额，也不是当前会话的 token 用量。

## 安装

需要 Node.js >=22.19 和提供 `modelRegistry.getProviderAuth()`、`before_provider_request`、`provider_stream_event` 的 pi（开发类型与集成测试使用 **1.2.0**，已通过 Pi SDK 全链路测试与离线加载验证）。运行时由 pi 提供宿主包，无运行时依赖；完整测试与类型检查需安装本项目开发依赖。项目代码统一为 TypeScript，由 Node 原生运行，无编译产物或额外 TS 运行器。

克隆后在包含 `package.json` 的项目根目录运行（解开 `.tgz` 后进入 `package/`）：

```bash
cd codex-limit

pi --offline -ne -e .   # 仅本次离线试用：不加载其他扩展、不改配置、不查凭据或额度
pi -ne -e .             # 仅本次在线试用：交互式启动会查询真实账号
pi install .            # 确认后安装为常驻扩展（写入 pi 包配置）
```

通过 GitHub 安装或更新：

```bash
pi install git:github.com/xiasheng32/codex-limit
pi update git:github.com/xiasheng32/codex-limit   # 已安装时更新到仓库最新版
```

安装或更新后重启 pi，或在已有会话中执行 `/reload`。

### 避免重复加载与单文件部署

- **包安装与 `~/.pi/agent/extensions/codex-limit.ts` 独立副本只能择一启用**，否则会重复注册命令、状态栏与查询任务。已有独立副本时先用 `pi config` 禁用旧来源，或备份后移出 autoload 目录；试用命令的 `-ne` 会隔离其他扩展。
- `extensions/index.ts` 依赖 `src/quota.ts`、`src/fast-mode.ts`、`src/fast-catalog.ts`，不能单独复制到 autoload 目录。单文件部署在项目根目录运行 `npm run sync-autoload`（默认覆盖 `~/.pi/agent/extensions/codex-limit.ts`，然后 `/reload`），或 `npm run sync-autoload -- /tmp/codex-limit.ts` 仅生成指定文件、不改启用中的插件。
- 同步脚本只更新指定输出文件；修改源码不会自动更新已有副本。请审阅源码后自行选择安装方式：离线模式不查询真实账号，在线交互式启动会查询；仓库和本地压缩包不含任何凭据。

## 使用

### 登录

- 在 pi 中执行 `/login openai-codex` 完成 ChatGPT OAuth 登录。扩展通过 pi 的公开认证接口获取 access token，续期由 **pi 自身**处理；不实现第二套 OAuth、不读取 `~/.codex/auth.json`、不另存令牌。
- 不需要 `.env` 或 API key；`OPENAI_API_KEY`、`openai` provider 登录及 Codex CLI 登录均不是本扩展的凭据来源。

### 命令

| 命令 | 功能 |
|---|---|
| `/codex-limit` | 查看额度、重置卡和 Fast 状态；缓存过期且不在退避/冷却期时刷新 |
| `/fast on` | 核对官方目录支持后开启当前会话的普通 Fast，要求当前使用官方 Codex 订阅 OAuth 模型 |
| `/fast off` | 关闭当前会话的 Fast |

- `u` 进入重置卡使用流程；`Enter`、`Esc` 或 `q` 关闭详情；窄/矮终端自动换行，`↑` / `↓` 滚动，`Home` / `End` 跳至首尾；日期采用本机时区。
- 重置卡显示服务端的可用张数、类型、有效期及记录中的已用/过期状态和使用时间。**不推断完整历史，不把缺失当 0，不按累计获得数倒算使用数**；未知状态、有效期和缺失记录明确标注。

### 会话内 Fast 模式

- 唯一开关入口是 `/fast on` 与 `/fast off`；裸 `/fast` 或无效参数显示用法，不改变选择。新会话默认关闭；选择保存为绑定 session ID 的会话记录，恢复同一会话或 `/reload` 时保留（不写全局配置、不进模型上下文），新建或 fork 会话不继承。保存失败保留原状态；切换模型保留选择并清除旧的响应观察。
- 能力判定不按模型名称猜测：向官方 `GET /backend-api/codex/models?client_version=<Pi 版本>` 查询模型目录，结果为支持、不支持或未知。内存缓存 5 分钟，查询失败退避 30 秒，账号切换隔离旧结果，离线模式不查询；目录缺失或查询失败显示能力未知。
- `/fast on` 先验证当前模型能力，仅目录明确支持才保存开关；能力未知、不支持或模型不适用时提示原因并保留原选择。对匹配**官方 `chatgpt.com` 端点 + `openai-codex` provider + `openai-codex-responses` API + OAuth 订阅认证**的模型请求：开关开启且能力支持时设 `service_tier: "priority"`，关闭时显式设 `default`，其余请求参数保留、其他请求不变。
- 页脚后缀：关闭无后缀；开启且能力支持 `· Fast`；保留开启偏好但能力未知 `· Fast能力未知`；能力不支持 `· Fast不可用`；切换其他供应商或非官方订阅模型后整条 Codex 状态栏隐藏，请求不变，切回恢复。`· Fast` 只表示能力支持且开关开启，**不代表服务端确认或速度提升**。
- 面板单独显示最近观察到的服务端档位：`priority` / `fast` 显示 Fast，`default` 显示"服务端返回标准档位"，缺失显示"未返回"，失败/不完整/并发归属不明显示"无法确认"。同模型前后台请求重叠后本次加载不再归属后续响应，重新加载或恢复会话后等待新请求；只影响观察，不改变能力判断与开关状态。扩展不自动重试或降级重发。
- 普通 Fast 的订阅额度消耗按标准模式的 **2.5 倍**；本版不启用 Ultrafast，未做真实测速，不承诺固定提速。参考 [OpenAI 速度说明](https://learn.chatgpt.com/docs/agent-configuration/speed)、[上游 pi-usage Fast 实现](https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-usage/src/codex-fast.ts)、[pi 扩展事件与会话接口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)。

### 手动使用重置卡

**唯一入口是 `/codex-limit` 详情面板底部的 `[ ↻ 重置额度 · u ]` 按钮，按 `u` 激活**；没有消费子命令或模型可调用工具。按钮独立分隔、加粗高亮、不随明细滚动，显示可用/不可用/处理中状态；不可用时按 `u` 仅提示原因。

1. 先重新查询额度和卡片明细，再选卡。只允许合法唯一 ID、状态可用且未到期的已知完全重置卡；有效期缺失显示未知、格式异常不能消费。查询失败、登录失效或冷却期间不能使用旧缓存。
2. 阅读所选卡、额度及不可撤销提示；确认页默认选项为**取消**，只有主动确认才发送消费请求，Esc、默认 Enter 或关闭均不消费。
3. 确认后再核对账号和卡片；账号改变、卡片失效或到期即取消，不替换成另一张卡。每次确认最多一次 POST，不自动使用、不自动重试。
4. 明确返回 `reset` 才提示服务端确认重置；`nothing_to_reset`、`no_credit`、`already_redeemed` 分别提示无需重置、无可用卡、已兑换。之后重新查询真实数据，不本地改成 100% 或减卡；同步失败单独提示并标注过期缓存。流程结束回到详情面板。

- 消费请求 10 秒超时。**发出后的断连、超时、5xx 或无法识别的响应可能已消费**：只查询同步、不重发，对应卡在当前实例内保持锁定，直至查询到明确已用/过期状态；已确认消费的卡不会因旧"可用"记录被重复使用。未决保护仅在内存，**重载/重启会清除锁；结果不明时先核对官方用量页，不要通过重载重试**。消费接口 429 冷却不可通过刷新绕过。
- RPC 模式仅手动执行命令时查询，结果用文本通知，不提供消费入口；print/json 无 UI 模式不启用 HUD、查询或消费。

### 刷新与状态

- 当前使用 Codex 订阅模型时，交互式会话启动非阻塞查询，每 60 秒和 `agent_settled` 时尝试刷新，自动请求至少间隔 30 秒；切换其他模型停止自动查询并隐藏状态栏，手动 `/codex-limit` 仍可查看详情。
- 一次仅一个刷新请求，每次重新通过 pi 解析认证，不永久缓存 token。选卡、确认和消费全程单飞，期间暂停其他刷新。
- 额度与重置卡请求各 10 秒超时，先额度后卡片。额度失败自动重试从 60 秒指数退避至最高 5 分钟，卡片失败独立退避 60 秒，不影响已成功的额度显示；两种查询的 429 冷却均不可绕过。
- 卡片明细失败保留并标注过期缓存；`usage` 提供的可用张数可作明细缺失时的摘要，HTTP 404/格式变化不等于没有重置卡。网络/数据错误保留上次数据并以 `🍧 Codex[过期] 额度：` 标记；认证失效、退出登录或账号变化清空旧数据。
- 未登录显示 `Codex 未登录`；认证、超时、限流和格式问题各有提示，详情不含原始异常或响应。没有主额度窗口显示"暂无主额度数据"，**不代表 0% 或无限额度**。
- 会话关闭、切换和重载时清理定时器，取消查询与等待并忽略迟到结果；取消本地等待不能撤销已发出的服务端消费。宿主的 OAuth 续期仍由 pi 管理，扩展无法取消。

离线模式连认证解析一起跳过，打开详情也不联网（`PI_OFFLINE` 见"配置"）：

```bash
pi --offline -ne -e .
```

### 安全与接口限制

- 查询仅向固定 `https://chatgpt.com/backend-api/wham/usage` 与 `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` 发 GET；只有详情面板选卡并明确确认后，才向固定 `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume` 发一次 POST（含所选 `credit_id` 和每次生成的 UUID `redeem_request_id`）。携带 OAuth Bearer 与账号路由头，拒绝重定向，不允许自定义端点。
- Fast 目录查询仅向官方 `https://chatgpt.com/backend-api/codex/models` 发带 Pi 版本参数的 GET，拒绝重定向，10 秒超时、响应上限 8 MiB；不向自定义端点查询或发送 Fast 参数。目录仅在内存保留一个账号的能力数据，账号或令牌变化即清除，不记录凭据或原始响应。
- 公开状态仅保留数量、已知状态、类型和时间；卡片 ID、账号关联与防重锁仅存控制器私有内存，消费请求 ID 只用于该请求，不写入 UI、会话、日志或磁盘。
- 只在内存解析 host-issued JWT payload 获取路由账号 ID；**这不是 JWT 签名验证**。不记录 access/refresh token、账号 ID、认证异常原文或完整响应。
- 扩展与 pi 拥有相同系统权限，请仅加载可信代码。这些是 Codex 内部用量与模型目录接口，**不是稳定的 OpenAI Platform 公共 API**，可能随时变化或拒绝请求；HTTP 401/403 时在 pi 重新登录。
- 目前只显示 `rate_limit` 主额度窗口，不混入模型专属额度、代码审查额度或 credits；额度足够也不保证模型服务没有容量限制。重置时间仅转述服务端值，不推断固定周期或恢复承诺。

接口参考：[Codex 查询与消费实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[消费返回码与卡片类型](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs)、[窗口数据模型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs)。

## 配置

- `PI_OFFLINE`：设为 `1`、`true` 或 `yes`（不区分大小写）时等价于 `pi --offline`，跳过认证解析与联网；更改后重启 pi 或 `/reload`。
- 无其他配置项：Fast 选择是会话内状态，不写入全局配置。

## 开发与测试

```bash
# 核心与同步脚本测试，无需安装额外依赖
node --test tests/codex-limit.test.ts tests/fast-mode.test.ts tests/catalog.test.ts tests/sync-autoload.test.ts

# 完整测试和类型检查：先安装开发依赖（不安装插件、不改全局 pi、不执行安装脚本）
npm ci --ignore-scripts --no-audit --no-fund
# 解包目录没有 package-lock.json 时改用 npm install --ignore-scripts --no-audit --no-fund
npm test           # 原生运行 tests/*.test.ts，含使用 pi 宿主开发依赖的入口集成测试
npm run typecheck  # 严格检查入口、核心、同步脚本与测试，不生成 JS
npm run check      # 类型检查 + 全部离线测试

pi --offline -ne -e . --help
```

- 测试覆盖额度解析、用卡全流程（确认/取消/单次 POST/四种官方返回码/未决锁）、Fast 路由与服务端档位、模型目录缓存与退避、会话恢复与模型切换、节流/单飞/退避/限流/关闭清理，以及临时目录中的同步脚本；只用合成 JWT、假认证、假 HTTP 响应、假选择 UI 和可控时间，**绝不消费真实卡片**。
- 入口集成测试经 Pi SDK 全链路（`createAgentSession` + `ExtensionRunner`）驱动真实 provider 序列化验证 slash commands 与请求档位；`tsconfig.json` 开启严格检查，Node 原生运行只擦除类型，不能替代 `npm run typecheck`。
- 帮助命令不查询真实额度，也不能单独证明扩展加载成功；如需核对真实数据，运行 `pi -ne -e .` 用 `/codex-limit` 对照官方用量页。
- 本地打包：`npm pack --offline --ignore-scripts --pack-destination ..` 生成上层 `codex-limit-0.4.0.tgz`，不安装插件、不发布 npm。上传 GitHub 使用本项目目录内容（`package.json` 位于仓库根目录），不要上传父目录、`.tgz`、凭据或本机配置；包清单为精确文件白名单，不含 `node_modules/`。

## 文件结构

```text
codex-limit/
├── extensions/index.ts             # pi 入口、HUD、命令与浮层
├── src/quota.ts                    # 可离线测试的解析、请求和状态机
├── src/fast-mode.ts                # 会话内 Fast 与服务端档位状态
├── src/fast-catalog.ts             # 官方模型目录、能力缓存与退避
├── tests/codex-limit.test.ts       # 额度解析、请求与状态机测试
├── tests/fast-mode.test.ts         # 会话内 Fast 与服务端档位测试
├── tests/catalog.test.ts           # 模型目录、缓存与退避测试
├── tests/extension.test.ts         # 命令、会话与模型切换集成验证
├── tests/transport.test.ts         # 真实宿主 HTTP/WebSocket 序列化的离线验证
├── tests/host.test.ts              # Pi SDK 全链路（createAgentSession + ExtensionRunner）
├── tests/sync-autoload.test.ts     # 临时目录中的同步脚本测试
├── scripts/sync-autoload.ts        # 显式同步 pi 自加载副本
├── tsconfig.json                   # 只做类型检查，不生成 JS
├── package-lock.json               # 开发依赖锁定
├── package.json
├── README.md
├── README.en.md
├── .gitignore
└── LICENSE
```

Pi 通过清单只加载入口文件；`src/` 同时包含在发布文件中，运行时不捆绑 pi 宿主包。

## 版本更新

当前版本 **v0.4.0**。完整更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

[MIT](./LICENSE)
