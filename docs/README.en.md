# pi-codex

[简体中文](../README.md) | [English](README.en.md)

> A [pi](https://pi.dev) extension that shows **remaining Codex subscription quota and reset countdowns** in the footer HUD, with plan, reset times, and reset-credit details, plus **session-local Fast mode**. It reuses pi's `openai-codex` OAuth login.

```text
🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)
```

## Features

- The footer shows only each window's remaining percentage and reset countdown in parentheses, without the plan name or outer parentheses. `(↻3h20m)` means about 3 hours 20 minutes until the server-provided reset time; missing times show `↻未知` (unknown) and elapsed times show `↻待刷新` (awaiting refresh). Quota is never restored to 100% locally.
- The footer keeps the default status colors, with existing colors and warning thresholds for low quota, stale data, elapsed resets, restrictions, and refreshes. Countdowns reuse the 60-second status updates and event refreshes, with no extra requests or timers.
- The detail panel includes the plan in its title, with quota → reset credits → Fast in the body. Body information lines (quota bars, reset countdowns, credit records, hint lines, the two Fast lines, and the fixed bottom `更新于 HH:mm · 本机时区` bar) are horizontally centered in the panel; the title bar and frame are unchanged. The three sections drop the long separators in favor of centered, color-coded short decorative headings — `─ 订阅额度 ─` (quota, cyan), `─ 重置卡 · 可用 N 张 ─` (reset credits · N available, purple), and `─ Fast ─` (green) — each with dark/light palettes; the reset button is a three-line boxed button. Full quota bars, reset countdowns, and credit records are preserved. Each window is judged independently: at ≤20% remaining (including 20% and 0%) its bar turns light red. Plan and credit data come from the server; missing values are marked unknown, and billing renewal dates are never inferred.
- Reset credits correspond to the Codex usage page's usage-limit reset feature, not a paid Credits balance. They can be redeemed manually with `u` in the detail panel; the extension never redeems them automatically.
- Session-local Fast mode: `/fast on` / `/fast off` affect only the current session and set `service_tier` for official subscription model requests based on the official model capability catalog.
- The server determines window counts and lengths; accounts are not guaranteed to have both a 5-hour and a 7-day window. These values are Codex subscription quota, not an OpenAI API account balance or the current session's token usage.

## Installation

Requires Node.js >=22.19 and a pi host exposing `modelRegistry.getProviderAuth()`, native `registerProvider()`, `before_provider_request`, and `provider_stream_event` (development types and integration tests use **1.2.0**, verified by full-pipeline Pi SDK tests and offline loading checks). At runtime pi supplies the host packages, with no runtime dependencies; the full test suite and type checking need this project's development dependencies. Project code is TypeScript run natively by Node, with no compiled artifacts or extra TS runner.

After cloning, run from the project root containing `package.json` (or the `package/` directory after extracting a `.tgz`, which ships only the files needed for installation and runtime, without `tests/`):

```bash
cd pi-codex

pi --offline -ne -e .   # Offline trial only: no other extensions, config changes, or queries
pi -ne -e .             # Online trial only: interactive startup queries the real account
pi install .            # Install persistently when ready; writes pi's package configuration
```

Install from or update via GitHub:

```bash
pi install git:github.com/xiasheng32/pi-codex
pi update git:github.com/xiasheng32/pi-codex   # Update an installed package
```

After installing or updating, restart pi or run `/reload` in an existing session.

### Avoid duplicate loading and generate a standalone file

- **Enable either the installed package or the standalone copy at `~/.pi/agent/extensions/pi-codex.ts`, never both**, or commands, statuses, and queries are registered twice. If a standalone copy exists, disable the old source with `pi config`, or back it up and move it out of the autoload directory. Trial commands use `-ne` to isolate other extensions.
- `extensions/index.ts` depends on `src/quota.ts`, `src/fast-mode.ts`, `src/fast-catalog.ts`, and `src/fast-provider.ts` and cannot be copied to the autoload directory alone. For a standalone deployment run `npm run sync-autoload` from the project root (overwrites `~/.pi/agent/extensions/pi-codex.ts` by default, then `/reload`), or `npm run sync-autoload -- /tmp/pi-codex.ts` to generate one file without touching the active extension.
- The script updates only the selected output file; editing the source does not update an existing copy. Review the source and choose an installation method: offline mode never queries the real account, while online interactive startup does. Neither the repository nor the local archive contains credentials.

### Migrating from codex-limit (v0.4.1 rename)

Starting with v0.4.1 the extension is named `pi-codex` instead of `codex-limit`. This is a breaking change; existing users migrate as follows:

1. The footer status key is now `pi-codex`: if you use a pi-cc-extensions custom footer, change `codex-limit` to `pi-codex` in its configuration (such as `footerLine2Keys`), otherwise the Codex status no longer shows in the footer.
2. The `/codex-limit` command is now `/pi-codex`; the old command is not kept as an alias. `/fast` is unchanged.
3. The standalone default output is now `~/.pi/agent/extensions/pi-codex.ts`: delete or move out the old `codex-limit.ts` copy and regenerate with `npm run sync-autoload`, otherwise the old and new copies load twice.
4. The repository is now `github.com/xiasheng32/pi-codex` (old URLs redirect). Installed users run `pi update git:github.com/xiasheng32/pi-codex`, then restart pi or `/reload`.

## Usage

### Login

- Run `/login openai-codex` in pi to complete the ChatGPT OAuth login. The extension obtains the access token through pi's public authentication interface; **pi itself** handles renewal. It implements no second OAuth flow, does not read `~/.codex/auth.json`, and stores no tokens.
- No `.env` or API key is required. `OPENAI_API_KEY`, `openai` provider login, and Codex CLI login do not supply this extension's credentials.

### Commands

| Command | Behavior |
|---|---|
| `/pi-codex` | Shows quota, reset-credit, and Fast details; refreshes stale data when not in backoff or cooldown |
| `/fast on` | Enables ordinary Fast after catalog validation; requires an active official Codex subscription OAuth model |
| `/fast off` | Disables Fast for this session |

- `u` starts the reset-credit flow at any scroll position; `Enter`, `Esc`, or `q` closes the details. Content wraps in narrow or short terminals; scroll with `↑` / `↓`, jump with `Home` / `End`. Dates use the local time zone.
- Reset-credit details show server-provided available counts, types, expiration dates, and records' used/expired status and usage times. **No complete history is inferred, missing values are never treated as zero, and usage is never derived from cumulative grants.** Unknown statuses, expirations, or missing records are explicitly marked.

### Session-local Fast mode

Only two lines appear under the panel's Fast heading: when enabled and supported, the first is `已开启 · ×2.5` (enabled · ×2.5), with a second line such as `响应待确认 · 仅本会话` (response pending confirmation · this session only); when disabled, the first line is `已关闭 · 标准` (disabled · standard). Limited capability uses short labels. The second line independently reflects observed server results and retains the session-only scope; it is not inferred from the switch. Model, routing, and long explanations are no longer permanently displayed in the panel.

- The only switches are `/fast on` and `/fast off`; bare `/fast` or invalid arguments show usage without changing the choice. New sessions default to off. The choice is stored as a session entry bound to the session ID and restored on resume or `/reload` (no global config, no model-context message); new and forked sessions do not inherit it. A failed save keeps the previous state; switching models retains the choice and clears old response observations.
- Capability is never guessed from model names: the extension queries the official catalog at `GET /backend-api/codex/models?client_version=<Pi version>` and reports supported, unsupported, or unknown. Results are cached in memory for 5 minutes, failed queries back off for 30 seconds, account changes isolate old results, and offline mode never queries. Missing catalog data or failed queries report unknown capability.
- `/fast on` validates the current model first and saves the switch only when the catalog explicitly supports it; unknown or unsupported capability or an ineligible model explains the reason and preserves the previous choice. For models matching **the official `chatgpt.com` endpoint + provider `openai-codex` + API `openai-codex-responses` + OAuth subscription authentication**, enabled with supported capability sets `service_tier: "priority"`; disabled sets `default` explicitly. Other request parameters and all other requests are unchanged. A thin native provider adapter preserves separate host `stream` / `streamSimple` behavior and makes the final tier decision after all payload events using the credentials captured by that request, not the UI's current login. Payload observers in other extensions may not yet see the final tier.
- Footer suffixes: none when disabled; `· Fast` when enabled with supported capability; `· Fast能力未知` (capability unknown) when an enabled preference is retained but capability is unknown; `· Fast不可用` (Fast unavailable) when unsupported. Switching to another provider or unofficial model hides the entire Codex status and leaves its requests unchanged; switching back restores it. `· Fast` only means supported capability plus an enabled switch, **not server confirmation or a measured speedup**.
- The panel separately reports the last observed server tier: `priority` / `fast` show Fast, `default` shows the standard tier, a missing tier shows as not returned, and failed, incomplete, or ambiguously attributed responses show as unconfirmable. After overlapping foreground/background requests to the same model, this loaded instance stops attributing later responses until a reload or resume starts a new lifecycle. This affects observations only; the extension never retries or resends at another tier.
- Ordinary Fast consumes subscription quota at **2.5 times** the standard rate. Ultrafast is not enabled in this version, no live speed was measured, and no fixed speedup is promised. See [OpenAI's speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed), the [upstream pi-usage Fast implementation](https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-usage/src/codex-fast.ts), and [pi's public extension interfaces](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts).

### Manually redeem a reset credit

**The only entry point is the boxed `↻ 重置额度 · u` button after the reset-credit details in the `/pi-codex` panel, activated with `u`** (a three-line box; very narrow terminals degrade to a one-line short label):

```text
┌────────────────────┐
│   ↻ 重置额度 · u   │
└────────────────────┘
```

The button scrolls with the body, but `u` works at any scroll position. There is no redemption subcommand or model-callable tool; credit selection and the second confirmation are unchanged. Persistent redemption guidance and equivalent prompts are removed from the panel; necessary unavailable, busy, and result messages appear only in the reset-credit section. When unavailable, pressing `u` only explains the reason.

1. The extension queries quota and credits again before you select a credit. Only known full-reset credits with valid unique IDs, an available state, and no elapsed expiry may be used; missing expiration is shown as unknown and malformed expiration prevents redemption. Failed queries, invalid login, or cooldown prevent using stale cached data.
2. Review the selected credit, quota, and the irreversible-action notice. Confirmation defaults to **Cancel**; only an explicit confirmation sends a redemption request. Esc, default Enter, or closing never redeems.
3. After confirmation the account and credit are rechecked; an account change, invalid credit, or expired credit cancels without substituting another credit. Each confirmation sends at most one POST, with no automatic use or retry.
4. Only `reset` is reported as a server-confirmed reset; `nothing_to_reset`, `no_credit`, and `already_redeemed` are reported as no reset needed, no available credit, and already redeemed. Real data is then queried again instead of setting quota to 100% or decrementing credits locally; a failed sync is reported separately with stale-cache marking. The flow returns to the detail panel.
- Redemption requests have a 10-second timeout. **A disconnect, timeout, 5xx, or unrecognized response after sending may mean the credit was already redeemed**: the extension only queries to synchronize and never resends. The credit stays locked throughout the session controller lifecycle, even after used/expired records, so a stale "available" rollback cannot authorize another request. Switching providers or accounts, and logging out within the same session, preserve locks and 429 cooldowns. Protection is in-memory only; **reloading or restarting clears the lock — when the result is uncertain, check the official usage page instead of reloading to retry.** A 429 cooldown cannot be bypassed by refreshing or switching providers within the session.
- RPC mode queries only on manual command invocation with text notifications and no redemption entry point; print/JSON modes without UI enable no HUD, queries, or redemption.

### Refresh policy and status

- The panel's fixed bottom bar reads `更新于 HH:mm · 本机时区` (updated at HH:mm · local time zone), using the last successful refresh timestamp, `lastSuccessAt`, formatted in the machine's local time zone. Without a value it reads `更新于 未知 · 本机时区` (updated at unknown · local time zone); a failed refresh keeps the previous timestamp.

- With a Codex subscription model active, interactive startup queries without blocking and attempts refresh every 60 seconds and on `agent_settled`, at least 30 seconds apart. Switching models stops automatic queries and hides the status; manual `/pi-codex` still shows details.
- Only one refresh runs at a time, resolving authentication through pi again instead of permanently caching tokens. Selection, confirmation, and redemption run as a single operation, pausing other refreshes throughout.
- Quota and credit requests each have a 10-second timeout, quota first. Failed quota queries retry with exponential backoff from 60 seconds up to 5 minutes; credit failures back off 60 seconds independently without hiding successful quota data. Neither query's 429 cooldown can be bypassed.
- Failed credit-detail queries keep a clearly marked stale cache; an available count from `usage` can summarize missing details, and HTTP 404 or a changed format does not mean no credits. Network/data errors keep the last data marked `🍧 Codex[过期] 额度：`; invalid authentication or detected logout/account changes clear old data. Identity checks continue during cooldown and backoff without bypassing HTTP cooldowns. Polling or settlement hides the HUD after detecting logout, and polling resumes after login.
- Missing login shows `Codex 未登录`; authentication, timeout, rate-limit, and format problems have distinct sanitized messages. Missing primary windows show that no primary quota data is available, **not 0% or unlimited quota**.
- Closing, switching, or reloading a session clears timers, cancels queries and waits, and ignores late results; switching providers within a session only suspends work and clears old account data while preserving redemption safety state. Canceling a local wait cannot undo a server-side redemption already sent. Host OAuth renewal stays managed by pi and cannot be cancelled by the extension.

Offline mode also skips authentication resolution and networking, including opening details (see `PI_OFFLINE` in Configuration):

```bash
pi --offline -ne -e .
```

### Security and API limitations

- Queries send GET requests only to the fixed `https://chatgpt.com/backend-api/wham/usage` and `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`. Only selecting and explicitly confirming a credit in the detail panel sends one POST to the fixed `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume`, with the chosen `credit_id` and a per-operation UUID `redeem_request_id`. Requests carry the OAuth Bearer and account-routing headers, reject redirects, and allow no custom endpoints.
- Fast catalog queries send only a GET with the Pi version parameter to the official `https://chatgpt.com/backend-api/codex/models`, rejecting redirects, with a 10-second timeout and an 8 MiB response limit. No catalog queries or Fast parameters go to custom endpoints. Only one account's capability data is cached in memory and cleared on account or token changes; credentials and raw responses are never recorded.
- Public state retains only counts, known statuses, types, and timestamps. Credit IDs, account associations, and duplicate-prevention locks stay in private controller memory; the redemption request ID is used only for that request and never written to UI, session, logs, or disk.
- A host-issued JWT payload is parsed in memory to obtain the routing account ID. **This is not JWT signature verification.** Access/refresh tokens, account IDs, raw authentication errors, and full responses are never recorded.
- Extensions have the same system permissions as pi; load trusted code only. These are internal Codex usage and model-catalog endpoints, **not stable public OpenAI Platform APIs**, and may change or reject requests; reauthenticate in pi after HTTP 401/403.
- Only primary `rate_limit` windows are shown; model-specific quotas, code-review quotas, and credits are not mixed in. Sufficient quota does not guarantee model-service capacity. Reset times merely relay server values, without inferring fixed cycles or promising recovery.

Implementation references: [Codex query and redemption client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs), [redemption return codes and credit types](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs), and the [window data model](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs).

## Configuration

- `PI_OFFLINE`: set to `1`, `true`, or `yes` (case-insensitive) for the equivalent of `pi --offline`, skipping authentication resolution and networking; restart pi or `/reload` after changing it.
- There are no other settings: the Fast choice is session-local state and is never written to global configuration.

## Development and testing

```bash
# Core and synchronization tests only: no extra dependencies needed
node --test tests/pi-codex.test.ts tests/fast-mode.test.ts tests/catalog.test.ts tests/sync-autoload.test.ts

# Full tests and type checking: in a cloned repository, install the development
# dependencies first without installing the extension, changing global pi, or running install scripts
npm ci --ignore-scripts --no-audit --no-fund
npm test           # Runs tests/*.test.ts natively, including host-dependent entry integration tests
npm run typecheck  # Strict checks for entry, core, script, and tests; no JS output
npm run check      # Type checking plus all offline tests

pi --offline -ne -e . --help
```

- Tests live only in the GitHub repository: the published file allowlist excludes `tests/`, so the `package/` directory from a `.tgz` is for installation and trial only; clone the repository to run the full suite and type checking.
- Tests cover quota parsing, the full redemption flow (confirm/cancel, a single POST, the four official return codes, unresolved-operation locks), Fast routing and server tiers, catalog caching and backoff, session restore and model switching, throttling, single-flight, backoff, rate limits, and shutdown cleanup, plus the sync script in temporary directories. They use only synthetic JWTs, fake authentication, fake HTTP responses, fake selection UI, and controlled time, and **never redeem real credits**.
- Entry integration tests drive real provider serialization over simulated transports through full-pipeline Pi SDK checks (`createAgentSession` + `ExtensionRunner`) to verify slash commands and request tiers. `tsconfig.json` enables strict checks; native Node execution only strips types and does not replace `npm run typecheck`.
- The help command queries no real quota and alone cannot prove extension loading; to check real data, run `pi -ne -e .` and compare `/pi-codex` with the official usage page.
- Local packaging: `npm pack --offline --ignore-scripts --pack-destination ..` creates `pi-codex-0.4.5.tgz` in the parent directory without installing the extension or publishing to npm. Upload this project's contents with `package.json` at the repository root; never upload the parent directory, `.tgz` files, credentials, or local configuration. The manifest uses an explicit file allowlist without `node_modules/` or `tests/` (tests remain in the GitHub repository).

## Project structure

```text
pi-codex/
├── README.md                      # Chinese guide and documentation entry
├── docs/
│   ├── README.en.md               # English guide
│   ├── CHANGELOG.md               # Chinese changelog
│   └── CHANGELOG.en.md            # English changelog
├── extensions/
│   └── index.ts                   # pi entry point, HUD, commands, and overlay
├── src/
│   ├── quota.ts                   # quota parsing, requests, and state machine
│   ├── fast-mode.ts               # session-local Fast and server-tier state
│   ├── fast-catalog.ts            # official model catalog, cache, and backoff
│   └── fast-provider.ts           # native provider adapter and request-auth binding
├── scripts/
│   └── sync-autoload.ts           # explicitly generates the standalone extension
├── tests/
│   ├── pi-codex.test.ts           # quota parsing, requests, and state machine
│   ├── fast-mode.test.ts          # session-local Fast and server tiers
│   ├── fast-provider.test.ts      # native options, auth binding, and concurrency
│   ├── catalog.test.ts            # model catalog, cache, and backoff
│   ├── extension.test.ts          # commands, sessions, model switching, and UI
│   ├── transport.test.ts          # HTTP/WebSocket serialization
│   ├── host.test.ts               # full-pipeline Pi SDK integration
│   ├── deployment.test.ts         # standalone extension loaded by the real host
│   └── sync-autoload.test.ts      # synchronization checks in temporary directories
├── package.json                   # package manifest, commands, and dependencies
├── package-lock.json              # locked development dependencies
├── tsconfig.json                  # strict type checking without JS output
├── .gitignore
└── LICENSE
```

pi loads only the manifest's entry point; `src/` is included in the distributed files, and pi host packages are not bundled at runtime.

## Version history

Current version **v0.4.5**. See the [changelog](CHANGELOG.en.md) for the full history.

## License

[MIT](../LICENSE).
