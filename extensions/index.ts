/** Codex subscription quota HUD. Authentication and OAuth refresh belong to pi. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey, rgbColor, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { detailLines, isLowQuota, isOffline, POLL_MS, PROVIDER, QuotaController, statusLine } from "../src/quota.ts";
import type { QuotaState } from "../src/quota.ts";
import { FAST_ENTRY, FastModeController, isCodexSubscription, restoreFastMode } from "../src/fast-mode.ts";

const STATUS_KEY = "codex-limit";
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
		if (width === 0) return [];
		const state = this.controller.getState();
		const now = Date.now();
		const theme = this.ctx.ui.theme;
		const button = this.controller.getResetButton();
		const buttonWidth = width < 6 || this.tui.terminal.rows < 10 ? width : Math.max(1, width - 4);
		const label = button.phase === "ready" ? "[ ↻ 重置额度 · u ]" : button.phase === "busy" ? "[ ↻ 重置额度 · 处理中 ]" : "[ ↻ 重置额度 · 不可用 ]";
		const shortLabel = button.enabled ? "[u 重置额度]" : button.phase === "busy" ? "[重置中]" : "[重置不可用]";
		const buttonText = theme.style(truncateToWidth(buttonWidth < 24 ? shortLabel : label, buttonWidth), {
			fg: button.enabled ? "accent" : button.phase === "busy" ? "warning" : "dim",
			bg: "selectedBg", bold: true,
		});
		if (width < 6 || this.tui.terminal.rows < 10) {
			const fastLines = this.fast.details(this.ctx.model, usesCodexSubscription(this.ctx));
			const compact = [fastLines[1]!, fastLines[3]!, "", ...detailLines(state, now)]
				.flatMap((line) => wrapTextWithAnsi(line, width));
			const bodyHeight = Math.max(1, this.tui.terminal.rows - 2);
			this.maxOffset = Math.max(0, compact.length - bodyHeight);
			this.offset = Math.min(this.offset, this.maxOffset);
			return [...compact.slice(this.offset, this.offset + bodyHeight), buttonText, "Enter/Esc 关闭 · ↑↓ 滚动"]
				.slice(0, Math.max(0, this.tui.terminal.rows)).map((line) => truncateToWidth(line, width));
		}
		const inner = width - 2;
		const contentWidth = Math.max(1, inner - 2);
		const paint = (line: string) => {
			if (line.startsWith("▸")) return theme.fg("accent", line);
			if (/过期缓存|查询失败|查询限流|查询超时|格式异常|已到期|结果不确定|未完成|被拒绝/.test(line)) return theme.fg("warning", line);
			if (line.startsWith("  ↻") || line.startsWith("     ") || /更新：|不会自动消费|不推断|未提供/.test(line)) return theme.fg("dim", line);
			return line;
		};
		const lowQuotaColor = theme.appearance === "light" ? LOW_QUOTA_LIGHT : LOW_QUOTA_DARK;
		const content = [...this.fast.details(this.ctx.model, usesCodexSubscription(this.ctx)), "", ...detailLines(state, now, contentWidth < 42 ? 12 : 24, (line, window) => {
			// Use the original window, not rounded display text or the other window's minimum.
			const color = statusLine({ ...state, snapshot: { ...state.snapshot!, windows: [window] } }, now).color;
			return line.split(/([█░]+)/).map((part) => isLowQuota(window.remainingPercent) && /[█░]/.test(part)
				? theme.style(part, { fg: lowQuotaColor }) : theme.fg(color, part)).join("");
		})].flatMap((line) => wrapTextWithAnsi(paint(line), contentWidth));
		const bodyHeight = Math.max(1, Math.min(24, this.tui.terminal.rows - (button.enabled ? 8 : 9)));
		this.maxOffset = Math.max(0, content.length - bodyHeight);
		this.offset = Math.min(this.offset, this.maxOffset);
		const row = (text: string) => {
			const value = truncateToWidth(` ${text}`, inner);
			return theme.fg("border", "│") + value + " ".repeat(Math.max(0, inner - visibleWidth(value))) + theme.fg("border", "│");
		};
		return [
			theme.fg("border", `╭${"─".repeat(inner)}╮`),
			row(theme.fg("accent", "🍧 Codex 额度")),
			theme.fg("border", `├${"─".repeat(inner)}┤`),
			...content.slice(this.offset, this.offset + bodyHeight).map((line) => row(line)),
			theme.fg(button.enabled ? "accent" : "border", `├${"─".repeat(inner)}┤`),
			row(" ".repeat(Math.max(0, Math.floor((contentWidth - visibleWidth(buttonText)) / 2))) + buttonText),
			...(!button.enabled ? [row(theme.fg("warning", truncateToWidth(button.hint, contentWidth)))] : []),
			theme.fg("border", `╰${"─".repeat(inner)}╯`),
			theme.fg("dim", ` Enter/Esc 关闭${this.maxOffset ? ` · ↑↓ 滚动 ${this.offset + 1}-${Math.min(content.length, this.offset + bodyHeight)}/${content.length}` : ""}`),
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

export default function codexLimit(pi: ExtensionAPI): void {
	// State is factory-local: reloads and different sessions cannot share requests.
	let controller: QuotaController | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeContext: ExtensionContext | undefined;
	const fast = new FastModeController();

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
				onChange: (state) => { if (controller === instance && activeContext) updateStatus(activeContext, state); },
			});
			controller = instance;
		}
		return controller;
	}

	function stop(ctx: ExtensionContext): void {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		controller?.dispose();
		controller = null;
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function startQuota(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || !ctx.hasUI || !usesCodexSubscription(ctx)) return;
		const instance = getController(ctx);
		updateStatus(ctx, instance.getState());
		void instance.refresh();
		if (timer === undefined && !isOffline(process.env.PI_OFFLINE)) {
			timer = setInterval(() => {
				if (!activeContext || !usesCodexSubscription(activeContext)) return;
				void instance.refresh();
				if (controller === instance) updateStatus(activeContext, instance.getState());
			}, POLL_MS);
			timer.unref();
		}
	}

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
		stop(ctx);
		fast.resetSession(restoreFastMode(ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId()));
		startQuota(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		activeContext = ctx;
		fast.resetResponse();
		if (!usesCodexSubscription(ctx)) stop(ctx);
		else startQuota(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		activeContext = ctx;
		const payload = fast.transform(event.payload, ctx.model, usesCodexSubscription(ctx));
		if (payload !== undefined && controller) updateStatus(ctx, controller.getState());
		return payload;
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
		if (ctx.mode !== "tui" || !controller || !usesCodexSubscription(ctx)) return;
		void controller.refresh();
		updateStatus(ctx, controller.getState());
	});

	pi.on("session_shutdown", (_event, ctx) => {
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
				ctx.ui.notify("Fast 仅适用于 Codex 订阅 OAuth 模型，请先切换到 openai-codex。", "warning");
				return;
			}
			try {
				pi.appendEntry(FAST_ENTRY, { enabled, sessionId: ctx.sessionManager.getSessionId() });
			} catch {
				ctx.ui.notify("无法保存当前会话的 Fast 开关，原状态保持不变。", "warning");
				return;
			}
			fast.setEnabled(enabled);
			if (controller) updateStatus(ctx, controller.getState());
			ctx.ui.notify(enabled ? "Fast 已开启，仅当前会话；订阅额度按标准的 2.5 倍消耗，实际档位以服务端返回为准。"
				: "Fast 已关闭，仅当前会话。", "info");
		},
	});

	pi.registerCommand("codex-limit", {
		description: "查看 Codex 额度与重置卡；详情按 u 使用卡",
		handler: async (args, ctx) => {
			activeContext = ctx;
			if (!ctx.hasUI) return;
			const argument = args.trim();
			if (argument) {
				ctx.ui.notify("用法：/codex-limit", "warning");
				return;
			}
			const instance = getController(ctx);
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
