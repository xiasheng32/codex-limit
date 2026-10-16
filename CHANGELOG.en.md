# Changelog

All notable changes to this project are documented in this file.
Versions follow [Semantic Versioning](https://semver.org/); dates are release dates.

## [0.4.3] - 2026-10-16

### Fixed
- Switching providers within a session now suspends quota work without erasing redemption locks or HTTP 429 cooldowns. Previously dispatched credits stay locked even if terminal records later regress to stale available records.
- Polling and settlement clear account caches, cancel old work, and hide the HUD after logout; polling resumes after login. Identity checks also run during cooldown and ordinary backoff without bypassing 429 or displaying the previous account.
- A thin native provider adapter binds Fast catalog checks to the actual request's captured OAuth credentials after all payload events, preventing account-switch races. Native stream/streamSimple options, OAuth, model configuration, and SSE/WebSocket behavior remain intact.
- Reset-credit dates strictly validate calendar days, leap years, clocks, and offsets; normalized invalid dates can no longer authorize redemption.
- Added regression coverage for account races, logout recovery, model-switch safety, terminal-record rollback, strict dates, and native provider options; standalone deployment and package allowlists include the adapter.

## [0.4.2] - 2026-10-15

### Changed
- Refined the detail panel: the title includes the plan, and the body follows quota → reset credits → Fast, preserving full quota details and credit records.
- Moved the reset button after the credit details so it scrolls with the body; `u` still works at any scroll position, with credit selection and the second confirmation unchanged. Removed persistent redemption guidance and equivalent prompts; necessary unavailable, busy, and result messages stay in the reset-credit section.
- Fast has only two lines below its heading: enabled and supported shows “已开启 · ×2.5” (enabled · ×2.5) and “响应待确认 · 仅本会话” (response pending confirmation · this session only); disabled shows “已关闭 · 标准” (disabled · standard). Limited capability uses short labels, server results remain independent of the switch, and model, routing, and long explanations are no longer permanently displayed.
- The fixed bottom bar reads “更新于 HH:mm · 本机时区” (updated at HH:mm · local time zone), using `lastSuccessAt` in the machine's local time zone; missing values show unknown, and failed refreshes keep the previous timestamp.
- Preserved stale-cache, refresh, and redemption safety logic; updated both READMEs, archive examples, and package and lockfile root versions to 0.4.2 while retaining the v0.4.1 rename migration notes.

## [0.4.1] - 2026-10-15

### Changed (breaking)
- Renamed the extension from `codex-limit` to `pi-codex`: the package name, footer status key, standalone default output `~/.pi/agent/extensions/pi-codex.ts`, and test filenames follow, and the GitHub repository is now `xiasheng32/pi-codex` (old URLs redirect).
- The `/codex-limit` command is now `/pi-codex`; the old command is not kept as an alias. `/fast` is unchanged.

### Migration
- If you use a pi-cc-extensions custom footer, change `codex-limit` to `pi-codex` in its configuration (such as `footerLine2Keys`), or the Codex status no longer shows in the footer.
- For standalone deployments, delete or move out the old `~/.pi/agent/extensions/codex-limit.ts` and regenerate `pi-codex.ts` with `npm run sync-autoload` to avoid double loading.
- Installed packages: run `pi update git:github.com/xiasheng32/pi-codex`, then restart pi or `/reload`.

## [0.4.0] - 2026-10-15

### Added
- New official model capability catalog `src/fast-catalog.ts`: queries `GET /backend-api/codex/models?client_version=<Pi version>` and reports Fast capability (supported/unsupported/unknown) from the catalog, never guessing from model names.
- Catalog results are cached in memory for 5 minutes, failed queries back off for 30 seconds, account changes isolate old results, and offline mode never queries; missing catalog data or query failures report unknown capability.
- `/fast on` validates the current model's capability first and saves the session switch only when the catalog explicitly supports it; unknown or unsupported capability or an ineligible model explains the reason and preserves the previous choice.
- `/codex-limit` details now show model capability, the requested tier, and the usage multiplier (ordinary Fast costs 2.5x the standard rate).
- New `tests/catalog.test.ts` and `tests/host.test.ts` (full-pipeline Pi SDK checks via `createAgentSession` + `ExtensionRunner`).

### Changed
- Fast request routing is now catalog-gated: only models matching the official `chatgpt.com` endpoint, provider `openai-codex`, API `openai-codex-responses`, and OAuth subscription authentication get `service_tier: "priority"` when enabled with supported capability, or an explicit `default` when disabled; other requests are unchanged.
- Footer Fast suffixes follow the requested route — `· Fast` / `· Fast能力未知` / `· Fast不可用` — instead of requiring server confirmation; the panel separately shows the last observed server tier.
- A retained enabled preference no longer requests Fast when capability is unknown or unsupported; switching to another provider or the regular OpenAI API hides the entire Codex status.
- Documentation overhaul: both READMEs now share one lean section structure, and the per-version lists moved into the new bilingual CHANGELOGs.

### Fixed
- The Codex subscription request tier value is again the endpoint-accepted `priority` (the v0.3.1 fix was reverted and is re-implemented here under catalog gating).

## [0.3.1] - 2026-10-14

### Fixed
- Corrected the Codex subscription request tier value to `priority`; the `fast` value used in v0.3.0 was rejected by the subscription endpoint with HTTP 400.

## [0.3.0] - 2026-10-14

### Added
- Session-local Fast mode with the only switches `/fast on` and `/fast off`; new sessions default to off, resuming the same session or `/reload` restores the choice, and new or forked sessions do not inherit it.
- Ordinary Fast applies only to `openai-codex` OAuth subscription model requests on `openai-codex-responses`; other providers and regular OpenAI API requests are unchanged.
- `/codex-limit` details show the session switch, model, and last observed server tier; the footer shows `· Fast` after server confirmation. Switching to another model hides the entire Codex status; switching back restores it.
- New `src/fast-mode.ts` with `tests/fast-mode.test.ts`, `tests/extension.test.ts`, and `tests/transport.test.ts`.

### Changed
- Standardized the footer icon as `🍧` across the package entry, core modules, and standalone autoload output; no new runtime dependencies.

## [0.2.3] - 2026-10-13

### Added
- New English documentation `README.en.md`, with a language-switch line at the top of both READMEs.

### Changed
- Standardized the package entry as `extensions/index.ts`, updating the pi extension manifest and packaging allowlist; the sync script, its tests, and both READMEs use the new entry path, while the standalone autoload output path is unchanged.
- Entry-point contents and core quota logic are unchanged; HUD, queries, and credit redemption behavior are unchanged.

## [0.2.2] - 2026-10-11

### Changed
- Simplified the footer to `🍧 Codex 额度：5h 96% (↻4h56m) 7d 87% (↻6d12h)`: removed the plan name and outer parentheses, wrapped each countdown separately, and separated windows with one space.
- The detail panel keeps the plan; stale, refreshing, and restricted indicators and color thresholds are unchanged, as are queries and credit redemption.
- Updated footer format regression tests covering Plus, Pro, and unknown plans.

## [0.2.1] - 2026-10-11

### Added
- Added `npm run typecheck` for strict type checking and `npm run check` for combined validation, with locked development dependencies.

### Changed
- Converted tests and the synchronization script to TypeScript, run natively by Node without an extra TypeScript runner or compiled artifacts.
- Retained the original 62 tests and added 2 synchronization tests in temporary directories, for 64 offline tests in total; no new runtime dependencies.

## [0.2.0] - 2026-10-11

### Added
- Manual reset-credit redemption with `u` in the detail panel: explicit credit selection, confirmation defaulting to cancel, account and credit rechecks, a single redemption request, and protection against repeating an unresolved operation; no automatic redemption or retry.
- Reset countdowns for each quota window in the footer, using the existing status colors without restoring quota locally.
- Detail progress bars turn light red when a window has ≤20% remaining (including 20% and 0%); added a fixed reset button.

### Changed
- Removed the `/codex-limit refresh` subcommand, keeping the `/codex-limit` details entry, automatic queries, and the fresh queries required for safe redemption.
- Simplified the detail summary and repeated timestamps.
