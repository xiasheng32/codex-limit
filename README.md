# codex-limit

一个 [pi](https://pi.dev) 扩展：在页脚 HUD 显示 **Codex 套餐与剩余额度**，详情保留重置时间和重置卡明细，复用 pi 的 `openai-codex` OAuth 登录。

```text
🦖 Codex 额度：( Plus | 5h 87% 7d 93% )
```

页脚仅显示套餐和各额度窗口的剩余百分比；重置倒计时、重置卡数量与使用记录在 `/codex-limit` 详情中查看。套餐及卡片数据以接口返回为准，缺失时明确标为未知，不会默认当成 Plus 或 0 张。不显示订阅到期日，也不推断账单续费日期。

窗口数量和长度以服务端为准，不保证每个账号都有“5 小时 + 7 天”两种窗口。这里不是 OpenAI API 账户余额，也不是当前会话的 token 用量。

## 安装与试用

需要 Node.js >=22.19 和提供 `modelRegistry.getProviderAuth()` 的 pi；已验证的宿主版本为 **1.0.4**。无需额外安装运行时或测试依赖，pi 提供宿主包。

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

安装后重新启动 pi，或在已有会话中执行 `/reload`。

### 避免重复加载与单文件部署

**包安装与 `~/.pi/agent/extensions/codex-limit.ts` 独立副本只能择一启用**，否则可能重复注册命令、状态栏与查询任务。已存在独立副本时，先通过 `pi config` 禁用旧来源，或备份后移出 autoload 目录；试用命令的 `-ne` 会隔离其他扩展。

`extensions/codex-limit.ts` 依赖 `src/quota.ts`，不能单独复制到 autoload 目录。若选择单文件部署，在项目根目录显式运行：

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
| `/codex-limit` | 打开额度与重置卡详情；缓存过期且不在退避/冷却期时刷新 |
| `/codex-limit refresh` | 跳过普通缓存节流刷新并打开详情；仍合并正在进行的请求、遵守 429 冷却 |

详情采用居中紧凑分区：套餐摘要、剩余额度进度条、重置倒计时、重置卡明细和更新时间。日期采用**本机时区**。`Enter`、`Esc` 或 `q` 关闭；窄/矮终端自动换行，必要时用 `↑` / `↓` 滚动，`Home` / `End` 跳至首尾。

重置卡对应 Codex 用量页面的“使用限额重置”，不是付费 Credits 余额。显示服务端的可用张数、卡片类型、有效期，以及接口返回记录中的已用/过期状态和使用时间。**不推断完整历史，不将缺失数据当成 0，不根据累计获得数倒算使用数**；未知状态、有效期和未提供的使用记录会明确标注。本扩展仅查询，**不会兑换或消耗重置卡**。

RPC 模式仅在手动执行命令时查询，结果使用文本通知；print/json 无 UI 模式不启用 HUD 或查询。

## 刷新与状态

- 交互式会话启动时非阻塞查询，每 60 秒和 `agent_settled` 时尝试刷新；自动请求统一至少间隔 30 秒。
- 一次仅有一个刷新请求；每次重新通过 pi 解析认证，不永久缓存 access token。
- 额度与重置卡 HTTP 请求各 10 秒超时。先显示额度，再查询卡片；额度失败后的自动重试从 60 秒起指数退避，最高 5 分钟。卡片查询失败独立退避 60 秒，不影响已成功的额度显示。两种查询的 429 冷却均不能被手动刷新绕过。
- 重置卡明细失败时保留并明确标注过期缓存；`usage` 若提供可用张数，则可作为明细缺失时的摘要。HTTP 404/格式变化不等于没有重置卡。
- 网络/数据错误保留上次成功数据，页脚以 `🦖 Codex[过期] 额度：` 明确标记；这不是当前额度。认证失效、退出登录或账号变化时清空旧数据。
- 未登录显示 `Codex 未登录`；认证、超时、限流和格式问题各有对应提示，详情不会包含原始异常或响应内容。
- 没有主额度窗口显示“暂无主额度数据”，**不代表 0% 或无限额度**。重置时间缺失显示未知，过去的重置时刻显示“待刷新”，不会自行把剩余比例恢复成 100%。
- 会话关闭、切换和重载时清理定时器、取消额度请求并忽略迟到结果。宿主已经开始的 OAuth 续期仍由 pi 自身管理，本扩展的公开认证接口无法取消它。

离线模式会连认证解析一起跳过，手动刷新也不会联网：

```bash
pi --offline -ne -e .
# 或 PI_OFFLINE=1 pi -ne -e .
```

`PI_OFFLINE` 支持 `1`、`true`、`yes`（不区分大小写）。更改后重新启动 pi 或 `/reload`。

## 安全与接口限制

- 仅向固定的 `https://chatgpt.com/backend-api/wham/usage` 与 `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` 发送 GET，携带 OAuth Bearer 和账号路由头；拒绝重定向，不允许自定义端点，不调用卡片消费接口。
- 重置卡只保留数量、已知状态、类型和时间，丢弃卡片 ID、用户信息、标题、描述等原始字段。
- 只在内存解析 host-issued JWT payload 获取路由账号 ID；**这不是 JWT 签名验证**。
- 不记录 access/refresh token、账号 ID、认证异常原文、完整响应，不把这些内容写入会话或普通日志。
- 扩展依然与 pi 拥有相同的系统权限，请仅加载可信代码。
- 这个接口是 Codex 内部用量接口，**不是稳定的 OpenAI Platform 公共 API**，可能随时变化或拒绝请求。HTTP 401/403 时请在 pi 重新登录；网络或代理异常时检查运行环境。
- 目前显示 `rate_limit` 的主额度窗口；不将模型专属额度、代码审查额度、credits 等其他字段混入主额度。额度足够也不保证模型服务没有容量限制。
- 重置时间仅转述服务端值，不推断固定的每周日历周期或额度恢复承诺。

接口参考：[Codex 请求实现](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[窗口数据模型](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs)。

## 开发与离线验证

在项目根目录运行：

```bash
npm test
# 等价于 node --test tests/codex-limit.test.mjs；不需要额外安装测试依赖

pi --offline -ne -e . --help
```

测试仅使用合成 JWT、假认证、假 HTTP 响应和可控时间；覆盖比例/窗口/重置解析、错误脱敏、节流、单飞、退避、限流和关闭清理。帮助命令不查询真实额度，但不能单独证明扩展加载成功，也不验证真实账号访问；离线交互式试用可检查 HUD 与命令是否注册。

如需核对真实数据，可自行运行 `pi -ne -e .`，用上面的两个命令对照 Codex 官方用量页检查剩余比例及重置时刻；这不是离线测试的一部分。

## 本地打包与上传 GitHub

在项目根目录运行：

```bash
npm pack --offline --ignore-scripts --pack-destination ..
# 上一级目录生成 codex-limit-0.1.0.tgz，不安装插件、不发布 npm
```

上传 GitHub 时使用本项目目录的内容，让 `package.json` 位于仓库根目录；不要把整个父目录、`.tgz`、凭据或本机配置上传。源码、测试、README、许可证和 `.gitignore` 均可保留。包清单使用精确文件白名单，不需要 `node_modules/`；压缩包解开后也可直接运行 `npm test` 和 `pi -ne -e .`。

## 文件结构

```text
codex-limit/
├── extensions/codex-limit.ts       # pi 入口、HUD、命令与浮层
├── src/quota.ts                   # 可离线测试的解析、请求和状态机
├── tests/codex-limit.test.mjs
├── scripts/sync-autoload.mjs      # 显式同步 pi 自加载副本
├── package.json
├── README.md
├── .gitignore
└── LICENSE
```

Pi 通过清单只加载入口文件；`src/` 同时包含在发布文件中。运行时不捆绑 pi 宿主包。

## 许可

[MIT](./LICENSE)
