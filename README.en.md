# codex-limit

[简体中文](README.md) | [English](README.en.md)

A [pi](https://pi.dev) extension that displays **remaining Codex subscription quota and reset countdowns** in the footer HUD. Its detail panel includes your plan, reset times, and reset-credit details, with **session-local Fast mode**. It reuses pi's `openai-codex` OAuth login.

```text
🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)
```

The extension's UI labels remain in Chinese. The footer uses the existing status colors without extra highlighting, bold text, or backgrounds. Low quota, stale data, elapsed reset times, restrictions, and refreshes retain their existing colors and warning thresholds.

The footer shows only each window's remaining percentage and reset countdown in parentheses, without the plan name or an outer pair of parentheses. The plan remains available in `/codex-limit`. `(↻3h20m)` means approximately 3 hours and 20 minutes until the server-provided reset time. Missing times show `↻未知` (unknown); elapsed times show `↻待刷新` (awaiting refresh). The extension never restores quota to 100% locally. Countdown updates reuse the existing 60-second status updates and event refreshes, without extra requests or timers; they do not tick every second.

Reset-credit counts, records, and the reset button remain in the detail panel. Plan and credit data come from the server; missing values are marked unknown rather than assumed to be Plus or zero credits. The extension neither displays subscription expiration dates nor infers billing renewal dates.

The server determines window counts and lengths. Accounts are not guaranteed to have both a 5-hour and a 7-day window. These values represent Codex subscription quota, not an OpenAI API account balance or the current session's token usage.

## What's new in v0.3.0

- Added `/fast on` and `/fast off` as the only Fast controls. New sessions default to off; resuming or reloading the same session restores its choice. New and forked sessions do not inherit it.
- Requests ordinary Fast only for `openai-codex` models using `openai-codex-responses`, without blocking the switch on the host OAuth flag. Quota requests still require OAuth; other providers and regular OpenAI API requests are unchanged.
- `/codex-limit` shows the session preference, model, and server tier. The footer shows `· Fast` only after server confirmation. Switching to another model hides the entire Codex status; switching back restores it.
- Standardized the footer icon as `🍧` and synchronized the package entry, both core modules, and standalone autoload output, with no new runtime dependencies.

## v0.3.1 fix

- Corrected the Codex subscription request tier to `priority`. The subscription endpoint rejected the `fast` value used in v0.3.0 with HTTP 400.

## What's new in v0.2.3

- Standardized the package entry point as `extensions/index.ts`, updating the pi extension manifest and packaging allowlist.
- Updated the synchronization script, its tests, and both READMEs to use the new entry path; the standalone autoload output path is unchanged.
- Entry-point contents and core quota logic are unchanged, with no changes to the HUD, queries, or reset-credit redemption behavior.

## What's new in v0.2.2

- Simplified the footer to `🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)`: removed the plan name and outer parentheses, wrapped each countdown separately, and separated windows with one space.
- Kept the plan in the detail panel. Stale, refreshing, and restricted indicators, color thresholds, queries, and credit redemption behavior are unchanged.
- Updated footer regression tests for Plus, Pro, and unknown plans.

## What's new in v0.2.1

- Converted tests and the synchronization script to TypeScript, retaining native Node execution without an extra TypeScript runner or compiled artifacts.
- Added strict type checking with `npm run typecheck`, combined validation with `npm run check`, and locked development dependencies.
- Retained the original 62 tests and added 2 synchronization tests in temporary directories, for 64 offline tests in total.
- Quota queries, manual credit redemption, and UI behavior are unchanged. No new runtime dependencies.

## What's new in v0.2.0

- Added manual reset-credit redemption with `u` in the detail panel: explicit credit selection, confirmation defaulting to cancel, account and credit rechecks, a single redemption request, and protection against repeating an operation with an unresolved result. No automatic redemption or retry.
- Added reset countdowns to the footer with existing status colors, without restoring quota locally.
- Detail progress bars turn light red when a window has ≤20% remaining. Added a fixed reset button and simplified repeated summaries and timestamps.
- Removed `/codex-limit refresh`. Kept `/codex-limit`, automatic queries, and fresh queries required for safe credit redemption.

## Installation and trials

Requires Node.js >=22.19 and a pi host exposing `modelRegistry.getProviderAuth()`, `before_provider_request`, and `provider_stream_event`. Development types and integration tests use **1.0.4**; the local **1.2.0** host passed offline loading and command-registration checks. At runtime, pi supplies the host packages without a separate runtime dependency installation; the full offline test suite and type checking require this project's development dependencies. Project-maintained TypeScript runs natively in Node without compiled artifacts or an extra runner. Development type checking requires the development dependencies.

After cloning, run these commands from the project root containing `package.json` (or the `package/` directory after extracting a `.tgz`):

```bash
cd codex-limit

# Offline trial for this run only: no other extensions, configuration changes,
# credential resolution, or quota queries
pi --offline -ne -e .

# Online trial for this run only: interactive startup queries the real account
pi -ne -e .

# Install persistently when ready; this writes pi's package configuration
pi install .
```

Install from GitHub:

```bash
pi install git:github.com/xiasheng32/codex-limit
```

Update an installed GitHub package to the latest repository version with:

```bash
pi update git:github.com/xiasheng32/codex-limit
```

After installing or updating, restart pi or run `/reload` in an existing session.

### Avoid duplicate loading and generate a standalone file

**Enable either the installed package or the standalone file at `~/.pi/agent/extensions/codex-limit.ts`, never both.** Loading both may register duplicate commands, statuses, and queries. If a standalone copy exists, disable the old source with `pi config`, or back it up and move it out of the autoload directory. Trial commands use `-ne` to isolate other extensions.

`extensions/index.ts` depends on `src/quota.ts` and `src/fast-mode.ts` and cannot be copied to the autoload directory on its own. For a standalone deployment, explicitly run from the project root:

```bash
npm run sync-autoload
# Overwrites ~/.pi/agent/extensions/codex-limit.ts by default;
# then run /reload in pi

# Or generate a local file without modifying the active extension
npm run sync-autoload -- /tmp/codex-limit.ts
```

The script only updates the selected output file, not other extensions or configuration. Editing the project source does not automatically update an existing standalone copy.

> Review the source and choose an installation method. Offline mode does not query the real account; online interactive startup does. Neither the repository nor the local archive includes credentials.

## Login

Run in pi:

```text
/login openai-codex
```

Complete the ChatGPT OAuth login. The extension obtains the current access token through pi's public authentication interface. **pi itself** handles renewal. The extension does not implement a second OAuth flow, read `~/.codex/auth.json`, or store its own tokens.

No `.env` or API key is required. A regular `OPENAI_API_KEY`, login to the `openai` provider, or Codex CLI login does not supply this extension's credentials.

## Commands

| Command | Behavior |
|---|---|
| `/codex-limit` | Shows quota, reset-credit, and Fast details; refreshes stale data when not in backoff or cooldown |
| `/fast on` | Enables ordinary Fast for this session; requires an active `openai-codex` Responses model |
| `/fast off` | Disables Fast for this session |

The centered detail panel contains a plan summary, remaining-quota progress bars, reset countdowns, reset-credit details, and an update timestamp. Each window independently uses its raw remaining ratio: **at ≤20%, including exactly 20% and 0%, its progress bar turns light red**, with colors adapted to light and dark themes. A low window does not change another window's bar. This only affects detail progress bars; footer color thresholds and stale/restricted indicators remain unchanged.

Dates use the **local time zone**. Press `u` to start the reset-credit flow; `Enter`, `Esc`, or `q` closes the panel. Content wraps in narrow or short terminals. Scroll with `↑` / `↓`; use `Home` / `End` to jump to the beginning or end.

Reset credits correspond to the Codex usage page's usage-limit reset feature, not a paid Credits balance. The panel shows server-provided available counts, types, expiration dates, and returned records' used/expired status and usage times. **It does not infer a complete history, treat missing values as zero, or derive usage counts from cumulative grants.** Unknown status, expiration, or unavailable usage records are explicitly marked. The extension never redeems credits automatically.

### Session-local Fast mode

Use only `/fast on` and `/fast off` to switch. The `/codex-limit` panel displays the preference, current model, actual server tier, and usage multiplier. It has no Fast button or `f` shortcut, and there is no `/fast status`, `/codex-limit fast` subcommand, or startup flag. Bare `/fast` and invalid arguments show usage without changing the preference or querying quota.

New sessions default to off. The choice is stored as a custom session entry bound to the current session ID. Resuming the same session or running `/reload` restores it, without a global configuration file or a message in model context. New and forked sessions default to off even if their history contains copied entries. A failed save leaves the previous preference unchanged. Switching models retains the session preference but clears the old server confirmation; switching back awaits confirmation from a new request.

Fast injection applies only when the current model has **provider `openai-codex` and API `openai-codex-responses`**. The Fast toggle does not depend on the synchronous `isUsingOAuth()` flag, which can be unavailable even when Pi can send a valid Codex request. Quota queries still require OAuth, and only the server can confirm the actual tier. When enabled, the public `before_provider_request` hook adds the `service_tier: "priority"` required by the Codex subscription endpoint while preserving other parameters. The public Responses API's `fast` value does not work on this subscription endpoint. When disabled, requests are untouched. Switching to another provider, regular `openai` API, or an ineligible model hides the entire Codex footer status and leaves its requests unchanged. Switching back restores it. `/fast on` with an ineligible model asks you to switch first and preserves the existing choice.

The public `provider_stream_event` hook observes server completion events. A `fast` or `priority` tier confirms Fast; `default` means the server used the standard tier. Missing or unknown tiers and failed or incomplete responses remain unconfirmed. Overlapping foreground and background requests to the same model also remain unconfirmed when their responses cannot be attributed reliably. After such an overlap, the current loaded instance stays unconfirmed; settling a turn, toggling off/on, or switching models does not clear the ambiguity. Reloading or resuming the session starts a new lifecycle that awaits confirmation from a new request. Normal requests without overlap are unaffected. Sending the Fast parameter alone does not confirm acceleration. The extension does not automatically retry or resend at another tier. Changing the switch does not affect requests already sent.

Example after server confirmation:

```text
🍧 Codex 额度：5h 78% (↻2h) 7d 64% (↻3d) · Fast
```

| State | Footer suffix |
|---|---|
| Disabled | None |
| Enabled, awaiting request confirmation | `· Fast待确认` |
| Server confirms Fast | `· Fast` |
| Server returns standard tier | `· Fast未生效` |
| Missing/unknown tier, failed/incomplete response, or ambiguous concurrent response | `· Fast未确认` |
| Other provider or non-subscription model | Entire Codex footer status hidden |

Ordinary Fast consumes subscription quota at **2.5 times** the standard rate. Availability depends on the model, account, and server. This version does not enable Ultrafast, has not measured live model speed, and promises no fixed speedup. See [OpenAI's speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed) and [pi's public extension event and session interfaces](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts).

### Manually redeem a reset credit

**The only entry point is the reset button at the bottom of the interactive `/codex-limit` detail panel, activated with `u`.** There is no redemption subcommand or model-callable tool. The button has its own separated area, bold highlighting, and a background; it does not scroll with the details. It shows available, unavailable, or processing status. When unavailable, the reason is shown, and pressing `u` only explains it without starting redemption.

```text
          [ ↻ 重置额度 · u ]
```

1. The extension queries quota and credits again, then asks you to select a specific credit. Only known full-reset credits with valid, unique IDs, an available state, and no elapsed expiry may be used. Missing expiration is marked unknown; malformed expiration prevents redemption. Failed queries, invalid login, or cooldown prevent using old cached data.
2. Review the selected credit, current quota, and irreversible-action notice. Confirmation defaults to **Cancel**. Only explicitly choosing to use the selected credit sends a redemption request. Esc, default Enter, or closing the dialog does not redeem it.
3. After confirmation, the extension rechecks the account and selected credit. An account change, invalid credit, or expired credit cancels the operation without substituting another credit. Each confirmation sends at most one POST, with no automatic redemption or retry.
4. Only `reset` is reported as a server-confirmed reset. `nothing_to_reset`, `no_credit`, and `already_redeemed` are reported as no reset needed, no available credit, and already redeemed, respectively; they do not count as a successful reset by this operation. The extension then queries actual quota and credits again instead of setting quota to 100% or reducing the credit count locally. A failed synchronization is reported separately with stale-cache marking. Completion or cancellation returns to the detail panel.

Each redemption request has a 10-second timeout. **A disconnect, timeout, 5xx response, or unrecognized response after sending may mean the credit was already redeemed.** The extension only queries to synchronize and does not resend. The selected credit stays locked in the current instance even if queries fail or return available/in-use, until a query explicitly reports it used or expired. Confirmed redeemed credits also cannot be reused because a temporary old record says available.

Unresolved-operation protection exists only in memory. **Reloading or restarting clears the lock; check the official usage page before trying anything else when the result is uncertain. Do not reload to retry redemption.** Refreshing cannot bypass a redemption endpoint's HTTP 429 cooldown.

RPC mode queries only when the command is invoked manually and uses text notifications, without a redemption entry point. Print/JSON modes without UI do not enable the HUD, queries, or redemption. Offline mode also skips authentication resolution.

## Refresh policy and status

- While a Codex subscription model is active, interactive startup queries without blocking, then attempts refresh every 60 seconds and on `agent_settled`. Automatic requests are at least 30 seconds apart. Switching to another model stops automatic queries and hides the entire status; manual `/codex-limit` can still show details.
- Only one refresh runs at a time. Each refresh resolves authentication through pi again instead of permanently caching the access token. Selection, confirmation, and redemption also run as a single operation; other refreshes pause throughout to avoid polling overwriting redemption data.
- Quota and reset-credit HTTP requests each have a 10-second timeout. Quota is displayed first, followed by a credit query. Automatic retries after failed quota queries back off from 60 seconds to a maximum of 5 minutes. Credit-query failures use a separate 60-second backoff without hiding successful quota data. Reopening details or attempting redemption cannot bypass either query's HTTP 429 cooldown.
- Failed credit-detail queries retain a clearly marked stale cache. If `usage` supplies an available count, it can serve as a summary when details are missing. HTTP 404 or a changed response format does not mean there are no reset credits.
- Network/data errors retain the last successful data and mark the footer `🍧 Codex[过期] 额度：`; it is not current quota. Invalid authentication, logout, or account changes clear old data.
- Missing login shows `Codex 未登录`. Authentication, timeout, rate-limit, and format problems have distinct messages. Details contain no raw exceptions or response bodies.
- Missing primary quota windows show that no primary quota data is available; **this does not mean 0% or unlimited quota**. Missing reset times are unknown; past reset times await refresh. Remaining percentages are never restored to 100% locally.
- Closing, switching, or reloading a session clears timers, cancels queries and waits for selection/redemption, and ignores late results. Canceling a local wait cannot undo a redemption already sent to the server. OAuth renewal already started by the host remains managed by pi; the extension's public authentication interface cannot cancel it.

Offline mode skips authentication resolution and network access, including opening details:

```bash
pi --offline -ne -e .
# Or: PI_OFFLINE=1 pi -ne -e .
```

`PI_OFFLINE` accepts `1`, `true`, or `yes`, case-insensitively. Restart pi or run `/reload` after changing it.

## Security and API limitations

- Queries send GET requests only to `https://chatgpt.com/backend-api/wham/usage` and `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`. Only selecting and explicitly confirming a credit in the detail panel sends one POST to `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume`, with the selected `credit_id` and a UUID `redeem_request_id` generated for that operation. Requests carry the OAuth Bearer token and account-routing header, reject redirects, and do not allow custom endpoints.
- Public state retains only counts, known statuses, types, and timestamps. Credit IDs, account associations, and duplicate-prevention locks remain in private controller memory. The redemption request ID is used only for that request, never written to the UI, session, logs, or disk. Raw user information, titles, descriptions, and similar fields are discarded.
- A host-issued JWT payload is parsed in memory to obtain the routing account ID. **This is not JWT signature verification.**
- Access/refresh tokens, account IDs, raw authentication errors, and full responses are never recorded in sessions or ordinary logs.
- Extensions retain the same system permissions as pi. Load trusted code only.
- These are internal Codex usage endpoints, **not stable public OpenAI Platform APIs**. They may change or reject requests. Reauthenticate in pi after HTTP 401/403; check your environment for network or proxy problems.
- The extension currently shows primary windows from `rate_limit`. It does not mix model-specific quotas, code-review quotas, credits, or other fields into primary quota. Sufficient quota does not guarantee model-service capacity.
- Reset times are reported from the server without inferring fixed weekly calendar cycles or promising quota recovery.

Implementation references: [Codex query and redemption client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs), [redemption return codes and credit types](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs), and [window data model](https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_window_snapshot.rs).

## Development and offline validation

Run from the project root:

```bash
# Core and synchronization tests only: no extra dependencies needed
node --test tests/codex-limit.test.ts tests/fast-mode.test.ts tests/sync-autoload.test.ts

# Full tests and type checking: install this project's development dependencies
# without installing the extension, changing global pi, or running install scripts
npm ci --ignore-scripts --no-audit --no-fund
# If an extracted package has no package-lock.json, use:
# npm install --ignore-scripts --no-audit --no-fund
npm test           # Runs tests/*.test.ts natively, including host-dependent entry integration tests
npm run typecheck  # Strict checks for entry point, core, script, and tests; no JS output
npm run check      # Type checking and all offline tests

pi --offline -ne -e . --help
```

The full suite's entry integration tests use pi host development dependencies. Type checking uses TypeScript, Node types, and pi 1.0.4 host packages as development-only dependencies. At runtime, pi supplies those packages; they are neither runtime dependencies nor bundled into the extension. `tsconfig.json` enables strict checks, unused-declaration checks, and erasable-syntax restrictions. Native Node execution strips types but does not replace `npm run typecheck`.

Tests retain all quota/redemption cases, add Fast request transformations, server tiers, commands, session restoration, and model switching, and cover explicit and default output paths for the TypeScript synchronization script. Both synchronization cases use temporary directories and a temporary HOME, without writing to the real pi autoload directory. Tests use only synthetic JWTs, fake authentication, fake HTTP responses, fake selection UI, and controlled time. They cover ratio/window/reset parsing, confirmation and cancellation, a single POST for the selected credit, the four official return codes, unresolved-operation locks, account switches, timeouts, sanitized errors, throttling, single-flight execution, backoff, rate limits, and shutdown cleanup. They never redeem real credits.

The help command does not query real quota, but alone cannot prove extension loading or real account access. An offline interactive trial can verify HUD and command registration.

To check real data yourself, run `pi -ne -e .`, then compare `/codex-limit` with the official Codex usage page for remaining percentages and reset times. This is outside the offline tests.

## Local packaging and GitHub uploads

Run from the project root:

```bash
npm pack --offline --ignore-scripts --pack-destination ..
# Creates codex-limit-0.3.1.tgz in the parent directory;
# does not install the extension or publish to npm
```

Upload this project's contents with `package.json` at the repository root. Do not upload the entire parent directory, `.tgz` files, credentials, or local configuration. Keep the source, tests, both READMEs, license, and `.gitignore`. The manifest uses an explicit file allowlist; `node_modules/` is unnecessary. After extracting the package, you can run the core tests above and `pi -ne -e .` directly. Install the development dependencies as described above before running the full `npm test` suite or type checking.

## Project structure

```text
codex-limit/
├── extensions/index.ts             # pi entry point, HUD, command, and overlay
├── src/quota.ts                   # parsing, requests, and state machine tested offline
├── src/fast-mode.ts               # session-local Fast and server-tier state
├── tests/codex-limit.test.ts
├── tests/fast-mode.test.ts
├── tests/extension.test.ts         # commands, sessions, and model-switch integration
├── tests/transport.test.ts         # offline host HTTP/WebSocket serializer checks
├── tests/sync-autoload.test.ts    # synchronization tests in temporary directories
├── scripts/sync-autoload.ts       # explicitly synchronizes the pi autoload copy
├── tsconfig.json                 # type checking only; no JavaScript output
├── package-lock.json             # locked development dependencies
├── package.json
├── README.md
├── README.en.md
├── .gitignore
└── LICENSE
```

pi loads only the manifest's entry point. `src/` is included in the distributed files. pi host packages are not bundled at runtime.

## License

[MIT](./LICENSE).
