/** Codex subscription quota HUD. Authentication and OAuth refresh belong to pi. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey, rgbColor, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { detailLines, detailSections, isLowQuota, isOffline, POLL_MS, PROVIDER, QuotaController, statusLine } from "../src/quota.ts";
import type { QuotaState } from "../src/quota.ts";
import { FAST_ENTRY, FastModeController, isCodexSubscription, restoreFastMode } from "../src/fast-mode.ts";
import type { FastCapability } from "../src/fast-mode.ts";
import { FastCatalog } from "../src/fast-catalog.ts";
import { createFastProvider } from "../src/fast-provider.ts";

const STATUS_KEY = "pi-codex";
const LOW_QUOTA_DARK = rgbColor(240, 160, 160);
const LOW_QUOTA_LIGHT = rgbColor(176, 82, 92);

function usesCodexSubscription(ctx: ExtensionContext): boolean {
	return !!ctx.model && isCodexSubscription(ctx.model, ctx.modelRegistry.isUsingOAuth(ctx.model));
}

export class QuotaPanel {
	private readonly tui: TUI;
	private readonly ctx: ExtensionContext;
	private readonly controller: QuotaController;
	private readonly done: (action?: "use") => void;
	private readonly fast: FastModeController;
	private finished = false;
	private offset = 0;
	private maxOffset = 0;

	constructor(tui: TUI, ctx: ExtensionContext, controller: QuotaController, done: (action?: "use") => void, fast: FastModeController) {
		this.tui = tui;
		this.ctx = ctx;
		this.controller = controller;
		this.done = done;
		this.fast = fast;
	}

	invalidate(): void {} // Lines and theme are recomputed on every render.

	render(availableWidth: number): string[] {
		const width = Math.max(0, Math.min(availableWidth, 68));
		const rows = Math.max(0, this.tui.terminal.rows);
		if (width === 0 || rows === 0) return [];
		// Leave room for the overlay's top and bottom margins when possible.
		const height = Math.max(1, rows - 2);
		const framed = width >= 24 && height >= 10;
		const contentWidth = framed ? width - 4 : width;
		const state = this.controller.getState();
		const now = Date.now();
		const theme = this.ctx.ui.theme;
		const button = this.controller.getResetButton();
		const lowQuotaColor = theme.appearance === "light" ? LOW_QUOTA_LIGHT : LOW_QUOTA_DARK;
		const sections = detailSections(state, now, contentWidth < 42 ? 12 : 24, (line, window) => {
			// Judge each original window independently, never its rounded display text.
			const color = statusLine({ ...state, snapshot: { ...state.snapshot!, windows: [window] } }, now).color;
			return line.split(/([█░]+)/).map((part) => isLowQuota(window.remainingPercent) && /[█░]/.test(part)
				? theme.style(part, { fg: lowQuotaColor }) : theme.fg(color, part)).join("");
		});
		const updated = theme.fg("dim", truncateToWidth(sections.updated, contentWidth));
		if (height === 1) {
			this.offset = this.maxOffset = 0;
			return [updated];
		}
		const heading = (title: string, summary = "") => {
			const start = `── ${title} `;
			const end = summary ? ` ${summary}` : "";
			const remaining = contentWidth - visibleWidth(start) - visibleWidth(end);
			return remaining < 2 ? theme.fg("accent", `${title}${summary ? ` · ${summary}` : ""}`)
				: theme.fg("accent", start) + theme.fg("border", "─".repeat(remaining)) + theme.fg("accent", end);
		};
		const paint = (line: string) => {
			if ((state.resetUse?.warning && line === state.resetUse.message)
				|| /过期缓存|查询失败|查询限流|查询超时|格式异常|已到期|结果不确定|未完成|被拒绝/.test(line)) return theme.fg("warning", line);
			if (line.startsWith("  ↻") || line.startsWith("     ") || /不推断|未提供/.test(line)) return theme.fg("dim", line);
			return line;
		};
		const title = "🍧 Codex 额度";
		const summaryFits = framed && sections.summary !== null
			&& visibleWidth(title) + 2 + visibleWidth(sections.summary) <= contentWidth;
		const header = theme.fg("accent", title) + (summaryFits
			? " ".repeat(contentWidth - visibleWidth(title) - visibleWidth(sections.summary!)) + theme.fg("dim", sections.summary!) : "");
		const lines: string[] = [];
		if (!summaryFits && sections.summary) lines.push(theme.fg("dim", sections.summary));
		if (sections.status.length) lines.push(...sections.status.map((line) => theme.fg(state.error || state.stale ? "warning" : "dim", line)), "");
		if (sections.quota.length) lines.push(heading("订阅额度"), ...sections.quota.map(paint), "");
		lines.push(heading("重置卡", sections.resetSummary), ...sections.resets.map(paint));
		if (!button.enabled && !sections.resets.some((line) => line.trim() === button.hint)) {
			lines.push(theme.fg(button.phase === "busy" ? "dim" : "warning", button.hint));
		}
		const label = button.phase === "ready" ? "[ ↻ 重置额度 · u ]" : button.phase === "busy" ? "[ ↻ 重置额度 · 处理中 ]" : "[ ↻ 重置额度 · 不可用 ]";
		const shortLabel = button.enabled ? "[u 重置额度]" : button.phase === "busy" ? "[重置中]" : "[重置不可用]";
		const buttonText = theme.style(truncateToWidth(contentWidth < 24 ? shortLabel : label, contentWidth), {
			fg: button.enabled ? "accent" : button.phase === "busy" ? "warning" : "dim", bg: "selectedBg", bold: true,
		});
		lines.push("", " ".repeat(Math.max(0, Math.floor((contentWidth - visibleWidth(buttonText)) / 2))) + buttonText, "");
		const fast = this.fast.summary(this.ctx.model, usesCodexSubscription(this.ctx));
		lines.push(heading("Fast"), theme.fg(fast.warning ? "warning" : "text", `${fast.switchLabel} · ${fast.costLabel}`),
			theme.fg(fast.warning ? "warning" : "dim", fast.responseLabel) + theme.fg("dim", " · 仅本会话"));
		const content = lines.flatMap((line) => wrapTextWithAnsi(line, contentWidth));
		const bodyHeight = height - (framed ? 6 : 1);
		this.maxOffset = Math.max(0, content.length - bodyHeight);
		this.offset = Math.min(this.offset, this.maxOffset);
		const body = content.slice(this.offset, this.offset + bodyHeight);
		if (!framed) return [...body, updated].map((line) => truncateToWidth(line, width));
		const inner = width - 2;
		const row = (text: string) => {
			const value = truncateToWidth(` ${text}`, inner);
			return theme.fg("border", "│") + value + " ".repeat(Math.max(0, inner - visibleWidth(value))) + theme.fg("border", "│");
		};
		return [
			theme.fg("border", `╭${"─".repeat(inner)}╮`), row(header),
			theme.fg("border", `├${"─".repeat(inner)}┤`), ...body.map(row),
			theme.fg("border", `├${"─".repeat(inner)}┤`), row(updated),
			theme.fg("border", `╰${"─".repeat(inner)}╯`),
		].map((line) => truncateToWidth(line, width));
	}

	handleInput(data: string): void {
		if (this.finished) return;
		if (data === "u" && !this.controller.getResetButton().enabled) {
			this.ctx.ui.notify(this.controller.getResetButton().hint, "warning");
			return;
		}
		if (data === "u" || matchesKey(data, "escape") || matchesKey(data, "return") || data === "q") {
			this.finished = true;
			this.done(data === "u" ? "use" : undefined);
		} else if (matchesKey(data, "up") || matchesKey(data, "down")) {
			this.offset = Math.max(0, Math.min(this.maxOffset, this.offset + (matchesKey(data, "up") ? -1 : 1)));
			this.tui.requestRender();
		} else if (matchesKey(data, "home") || matchesKey(data, "end")) {
			this.offset = matchesKey(data, "home") ? 0 : this.maxOffset;
			this.tui.requestRender();
		}
	}
}

export default function piCodex(pi: ExtensionAPI): void {
	// State is factory-local: reloads and different sessions cannot share requests.
	let controller: QuotaController | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeContext: ExtensionContext | undefined;
	const fast = new FastModeController();
	let fastGeneration = 0;
	let preferenceRevision = 0;
	let capabilityRevision = 0;
	let latestCapability = 0;
	const catalog = new FastCatalog({
		resolveAuth: async () => activeContext?.modelRegistry.getProviderAuth(PROVIDER),
		version: VERSION, offline: isOffline(process.env.PI_OFFLINE),
	});
	const modelKey = (ctx: ExtensionContext) => JSON.stringify([ctx.model?.provider, ctx.model?.api, ctx.model?.id, ctx.model?.baseUrl]);
	async function readCapability(ctx: ExtensionContext): Promise<FastCapability | undefined> {
		const owner = fastGeneration;
		const revision = ++capabilityRevision;
		const key = modelKey(ctx);
		const session = ctx.sessionManager.getSessionId();
		const capability = await catalog.read(ctx.model, usesCodexSubscription(ctx));
		if (owner !== fastGeneration || key !== modelKey(ctx) || session !== ctx.sessionManager.getSessionId()) return undefined;
		if (!usesCodexSubscription(ctx)) {
			catalog.reset();
			fast.setCapability({ kind: "unknown", reason: "Codex 登录已变化" });
			if (controller) updateStatus(ctx, controller.getState());
			return undefined;
		}
		if (revision >= latestCapability) {
			latestCapability = revision;
			fast.setCapability(capability);
			if (controller) updateStatus(ctx, controller.getState());
		}
		return capability;
	}

	function updateStatus(ctx: ExtensionContext, state: QuotaState): void {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		if (!usesCodexSubscription(ctx)) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const status = statusLine(state, Date.now());
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(status.color, status.text + fast.suffix()));
	}

	function getController(ctx: ExtensionContext): QuotaController {
		if (!controller) {
			const instance = new QuotaController({
				resolveAuth: () => ctx.modelRegistry.getProviderAuth(PROVIDER),
				offline: isOffline(process.env.PI_OFFLINE),
				onChange: (state) => {
					if (controller === instance && activeContext && usesCodexSubscription(activeContext)) updateStatus(activeContext, state);
				},
			});
			controller = instance;
		}
		return controller;
	}

	function hideQuota(ctx: ExtensionContext): void {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		// Model changes must not erase this session's consumption locks or cooldowns.
		controller?.suspend();
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function stop(ctx: ExtensionContext): void {
		hideQuota(ctx);
		controller?.dispose();
		controller = null;
	}

	function refreshQuota(ctx: ExtensionContext, instance: QuotaController): void {
		if (!usesCodexSubscription(ctx)) {
			// Logout does not emit model_select. Keep polling for a later login,
			// but cancel old work and clear the previous account immediately.
			instance.suspend();
			catalog.reset();
			fast.setCapability({ kind: "unknown", reason: "Codex 登录已变化" });
			fast.resetResponse();
			updateStatus(ctx, instance.getState());
			return;
		}
		void instance.refresh();
		updateStatus(ctx, instance.getState());
	}

	function startQuota(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || !ctx.hasUI || !isCodexSubscription(ctx.model, true)) return;
		const instance = getController(ctx);
		refreshQuota(ctx, instance);
		if (timer === undefined && !isOffline(process.env.PI_OFFLINE)) {
			timer = setInterval(() => {
				if (activeContext && controller === instance) refreshQuota(activeContext, instance);
			}, POLL_MS);
			timer.unref();
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		fastGeneration++;
		preferenceRevision++;
		catalog.reset();
		activeContext = ctx;
		stop(ctx);
		fast.resetSession(restoreFastMode(ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId()));
		startQuota(ctx);
		if (fast.enabled && usesCodexSubscription(ctx)) await readCapability(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		fastGeneration++;
		preferenceRevision++;
		activeContext = ctx;
		fast.resetResponse();
		fast.setCapability({ kind: "unknown" });
		if (!isCodexSubscription(ctx.model, true)) hideQuota(ctx);
		else startQuota(ctx);
		if (fast.enabled && usesCodexSubscription(ctx)) void readCapability(ctx);
	});

	// The payload event exposes no request credentials. Bind the final tier to
	// the native provider's already-resolved token, not the current login.
	pi.registerProvider(createFastProvider((model, apiKey, signal) => {
		const owner = fastGeneration;
		const revision = preferenceRevision;
		const key = JSON.stringify([model.provider, model.api, model.id, model.baseUrl]);
		const applicable = !!activeContext && key === modelKey(activeContext)
			&& isCodexSubscription(model, usesCodexSubscription(activeContext));
		return async (payload) => {
			if (!applicable) return undefined;
			const current = () => owner === fastGeneration && revision === preferenceRevision
				&& !!activeContext && key === modelKey(activeContext) && usesCodexSubscription(activeContext);
			const capability: FastCapability = fast.enabled && current()
				? await catalog.readForAuth(model, true, apiKey ? { source: "OAuth", auth: { apiKey } } : undefined, signal)
				: { kind: "unknown" };
			if (!current()) {
				// A replaced session/model must not mutate the new response tracker.
				if (payload !== null && typeof payload === "object" && !Array.isArray(payload)
					&& (payload as Record<string, unknown>).model === model.id && Array.isArray((payload as Record<string, unknown>).input)) {
					return { ...payload, service_tier: "default" };
				}
				return undefined;
			}
			const result = fast.transform(payload, model, true, capability);
			if (controller && activeContext) updateStatus(activeContext, controller.getState());
			return result;
		};
	}));

	pi.on("before_provider_request", async (_event, ctx) => {
		activeContext = ctx;
		if (fast.enabled && usesCodexSubscription(ctx)) await readCapability(ctx);
	});

	pi.on("provider_stream_event", (event, ctx) => {
		if (event.provider !== PROVIDER || !usesCodexSubscription(ctx)) return;
		const previousPhase = fast.phase;
		fast.observe(event);
		if (controller && previousPhase !== fast.phase) updateStatus(ctx, controller.getState());
	});

	pi.on("agent_settled", (_event, ctx) => {
		activeContext = ctx;
		fast.settle();
		if (ctx.mode !== "tui" || !controller) return;
		refreshQuota(ctx, controller);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		fastGeneration++;
		preferenceRevision++;
		catalog.reset();
		stop(ctx);
		fast.setEnabled(false);
		activeContext = undefined;
	});

	pi.registerCommand("fast", {
		description: "仅当前会话：/fast on 开启 Codex Fast，/fast off 关闭",
		handler: async (args, ctx) => {
			activeContext = ctx;
			const value = args.trim();
			if (value !== "on" && value !== "off") {
				ctx.ui.notify("用法：/fast on 或 /fast off（仅当前会话，新会话默认关闭）", "warning");
				return;
			}
			const enabled = value === "on";
			if (enabled && !usesCodexSubscription(ctx)) {
				ctx.ui.notify("Fast 仅适用于官方 Codex 订阅 OAuth 模型，请先切换到 openai-codex。", "warning");
				return;
			}
			const revision = ++preferenceRevision;
			const owner = fastGeneration;
			const session = ctx.sessionManager.getSessionId();
			if (enabled) {
				const capability = await readCapability(ctx);
				if (!capability || !usesCodexSubscription(ctx) || revision !== preferenceRevision || owner !== fastGeneration || session !== ctx.sessionManager.getSessionId()) return;
				if (capability.kind !== "supported") {
					ctx.ui.notify(capability.reason ?? (capability.kind === "unsupported" ? "当前模型的官方目录不支持 Fast。" : "当前模型的 Fast 能力未知，未启用 Fast。"), "warning");
					return;
				}
			}
			try {
				pi.appendEntry(FAST_ENTRY, { enabled, sessionId: ctx.sessionManager.getSessionId() });
			} catch {
				ctx.ui.notify("无法保存当前会话的 Fast 开关，原状态保持不变。", "warning");
				return;
			}
			fast.setEnabled(enabled);
			if (controller) updateStatus(ctx, controller.getState());
			ctx.ui.notify(enabled ? "Fast 路由已开启，仅当前会话（priority）；订阅额度按标准的 2.5 倍消耗。面板独立显示服务端返回档位。"
				: "Fast 已关闭，仅当前会话。", "info");
		},
	});

	pi.registerCommand("pi-codex", {
		description: "查看 Codex 额度与重置卡；详情按 u 使用卡",
		handler: async (args, ctx) => {
			activeContext = ctx;
			if (!ctx.hasUI) return;
			const argument = args.trim();
			if (argument) {
				ctx.ui.notify("用法：/pi-codex", "warning");
				return;
			}
			const instance = getController(ctx);
			if (usesCodexSubscription(ctx)) await readCapability(ctx);
			await instance.refresh();
			if (controller !== instance) return; // Context may have been invalidated while awaiting auth.
			if (ctx.mode === "tui") {
				while (controller === instance) {
					const action = await ctx.ui.custom<"use" | undefined>(
						(tui, _theme, _keybindings, done) => new QuotaPanel(tui, ctx, instance, done, fast),
						{ overlay: true, overlayOptions: { anchor: "center", width: 68, margin: 1 } },
					);
					if (controller !== instance || action !== "use") break;
					// The overlay is disposed before opening built-in dialogs. Only this u path consumes.
					await instance.useResetCredit({
						select: (title, options) => ctx.ui.select(title, options),
						notify: (message, type) => ctx.ui.notify(message, type),
					});
				}
			} else {
				const state = instance.getState();
				ctx.ui.notify([...fast.details(ctx.model, usesCodexSubscription(ctx)), "", ...detailLines(state, Date.now())].join("\n"), state.error ? "warning" : "info");
			}
		},
	});
}
