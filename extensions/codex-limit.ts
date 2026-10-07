/** Codex subscription quota HUD. Authentication and OAuth refresh belong to pi. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { detailLines, isOffline, POLL_MS, PROVIDER, QuotaController, statusLine } from "../src/quota.ts";
import type { QuotaState } from "../src/quota.ts";

const STATUS_KEY = "codex-limit";

export class QuotaPanel {
	private readonly tui: TUI;
	private readonly ctx: ExtensionContext;
	private readonly controller: QuotaController;
	private readonly done: () => void;
	private offset = 0;
	private maxOffset = 0;

	constructor(tui: TUI, ctx: ExtensionContext, controller: QuotaController, done: () => void) {
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
		if (width < 6 || this.tui.terminal.rows < 8) {
			return [statusLine(state, now).text, "Enter/Esc 关闭"].map((line) => truncateToWidth(line, width));
		}
		const inner = width - 2;
		const contentWidth = Math.max(1, inner - 2);
		const paint = (line: string) => {
			if (line.startsWith("▸")) return theme.fg("accent", line);
			if (/[█░]/.test(line)) return theme.fg(statusLine(state, now).color, line);
			if (/过期缓存|查询失败|查询限流|查询超时|格式异常|已到期/.test(line)) return theme.fg("warning", line);
			if (line.startsWith("  ↻") || line.startsWith("     ") || /更新：|只读查询|不推断|未提供/.test(line)) return theme.fg("dim", line);
			return line;
		};
		const content = detailLines(state, now, contentWidth < 42 ? 12 : 24).flatMap((line) => wrapTextWithAnsi(paint(line), contentWidth));
		const bodyHeight = Math.max(1, Math.min(24, this.tui.terminal.rows - 7));
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
			theme.fg("border", `╰${"─".repeat(inner)}╯`),
			theme.fg("dim", `${this.maxOffset ? ` ↑↓ 滚动 ${this.offset + 1}-${Math.min(content.length, this.offset + bodyHeight)}/${content.length} ·` : ""} Enter/Esc 关闭`),
		].map((line) => truncateToWidth(line, width));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || data === "q") {
			this.done();
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
		description: "查看 Codex 订阅额度与重置卡；加 refresh 手动刷新",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const argument = args.trim();
			if (argument && argument !== "refresh") {
				ctx.ui.notify("用法：/codex-limit 或 /codex-limit refresh", "warning");
				return;
			}
			const instance = getController(ctx);
			await instance.refresh(argument === "refresh");
			if (controller !== instance) return; // Context may have been invalidated while awaiting auth.
			if (ctx.mode === "tui") {
				await ctx.ui.custom<undefined>(
					(tui, _theme, _keybindings, done) => new QuotaPanel(tui, ctx, instance, () => done(undefined)),
					{ overlay: true, overlayOptions: { anchor: "center", width: 68, margin: 1 } },
				);
			} else {
				const state = instance.getState();
				ctx.ui.notify(detailLines(state, Date.now()).join("\n"), state.error ? "warning" : "info");
			}
		},
	});
}
