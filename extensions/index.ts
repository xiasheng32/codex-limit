/** Codex subscription quota HUD. Authentication and OAuth refresh belong to pi. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey, rgbColor, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { detailLines, isLowQuota, isOffline, POLL_MS, PROVIDER, QuotaController, statusLine } from "../src/quota.ts";
import type { QuotaState } from "../src/quota.ts";

const STATUS_KEY = "codex-limit";
const LOW_QUOTA_DARK = rgbColor(240, 160, 160);
const LOW_QUOTA_LIGHT = rgbColor(176, 82, 92);

export class QuotaPanel {
	private readonly tui: TUI;
	private readonly ctx: ExtensionContext;
	private readonly controller: QuotaController;
	private readonly done: (action?: "use") => void;
	private finished = false;
	private offset = 0;
	private maxOffset = 0;

	constructor(tui: TUI, ctx: ExtensionContext, controller: QuotaController, done: (action?: "use") => void) {
		this.tui = tui;
		this.ctx = ctx;
		this.controller = controller;
		this.done = done;
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
			return [statusLine(state, now).text, buttonText, "Enter/Esc 关闭"]
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
		const content = detailLines(state, now, contentWidth < 42 ? 12 : 24, (line, window) => {
			// Use the original window, not rounded display text or the other window's minimum.
			const color = statusLine({ ...state, snapshot: { ...state.snapshot!, windows: [window] } }, now).color;
			return line.split(/([█░]+)/).map((part) => isLowQuota(window.remainingPercent) && /[█░]/.test(part)
				? theme.style(part, { fg: lowQuotaColor }) : theme.fg(color, part)).join("");
		}).flatMap((line) => wrapTextWithAnsi(paint(line), contentWidth));
		const bodyHeight = Math.max(1, Math.min(24, this.tui.terminal.rows - (button.enabled ? 8 : 9)));
		this.maxOffset = Math.max(0, content.length - bodyHeight);
		this.offset = Math.min(this.offset, this.maxOffset);
		const row = (text: string) => {
			const value = truncateToWidth(` ${text}`, inner);
			return theme.fg("border", "│") + value + " ".repeat(Math.max(0, inner - visibleWidth(value))) + theme.fg("border", "│");
		};
		return [
			theme.fg("border", `╭${"─".repeat(inner)}╮`),
			row(theme.fg("accent", "🦖 Codex 额度")),
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

	function updateStatus(ctx: ExtensionContext, state: QuotaState): void {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		const status = statusLine(state, Date.now());
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(status.color, status.text));
	}

	function getController(ctx: ExtensionContext): QuotaController {
		if (!controller) {
			const instance = new QuotaController({
				resolveAuth: () => ctx.modelRegistry.getProviderAuth(PROVIDER),
				offline: isOffline(process.env.PI_OFFLINE),
				onChange: (state) => { if (controller === instance) updateStatus(ctx, state); },
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

	pi.on("session_start", (_event, ctx) => {
		stop(ctx);
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		const instance = getController(ctx);
		updateStatus(ctx, instance.getState());
		void instance.refresh();
		if (!isOffline(process.env.PI_OFFLINE)) {
			timer = setInterval(() => {
				void instance.refresh();
				if (controller === instance) updateStatus(ctx, instance.getState());
			}, POLL_MS);
			timer.unref();
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui" || !controller) return;
		void controller.refresh();
		updateStatus(ctx, controller.getState());
	});

	pi.on("session_shutdown", (_event, ctx) => stop(ctx));

	pi.registerCommand("codex-limit", {
		description: "查看 Codex 额度与重置卡；详情按 u 使用卡",
		handler: async (args, ctx) => {
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
						(tui, _theme, _keybindings, done) => new QuotaPanel(tui, ctx, instance, done),
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
				ctx.ui.notify(detailLines(state, Date.now()).join("\n"), state.error ? "warning" : "info");
			}
		},
	});
}
