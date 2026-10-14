import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { TestContext } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import codexLimit, { QuotaPanel } from "../extensions/index.ts";
import { FAST_ENTRY, FastModeController } from "../src/fast-mode.ts";
import { QuotaController } from "../src/quota.ts";
import { FastCatalog } from "../src/fast-catalog.ts";
import type { FastModel } from "../src/fast-mode.ts";
import type { QuotaState } from "../src/quota.ts";

// No real credential lookup, model request, quota request or reset consumption is allowed.
process.env.PI_OFFLINE = "1";
globalThis.fetch = async () => { throw new Error("Unexpected live fetch in extension test"); };
const codex: FastModel = { id: "gpt-6.1-sol", provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" };

// Catalog wire/auth tests live separately. Extension tests inject capability facts.
beforeEach(() => { mock.method(FastCatalog.prototype, "read", async () => ({ kind: "supported" as const })); });
afterEach(() => { mock.restoreAll(); });
const payload = () => ({ model: codex.id, input: [], reasoning: { effort: "high" }, tools: [], prompt_cache_key: "synthetic-cache" });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
type Entry = { type: "custom"; customType: string; data: { enabled: boolean; sessionId: string } };
type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
type Factory = (tui: TUI, theme: unknown, keys: unknown, done: (action?: "use") => void) => QuotaPanel;

function harness(options: { entries?: Entry[]; sessionId?: string; model?: FastModel; oauth?: boolean; mode?: string; hasUI?: boolean } = {}) {
	const events = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const entries = options.entries ?? [];
	const notices: { message: string; type: string }[] = [];
	const statusHistory: { key: string; text: string | undefined }[] = [];
	const statuses = new Map<string, string | undefined>();
	const panels: QuotaPanel[] = [];
	let authCalls = 0;
	let appendFailure = false;
	let selected = 0;
	let oauth = options.oauth ?? true;
	let sessionId = options.sessionId ?? "session-A";
	let renders = 0;
	const terminal = { rows: 32 };
	const tui = { terminal, requestRender: () => { renders++; } } as unknown as TUI;
	const rawContext = {
		mode: options.mode ?? "tui", hasUI: options.hasUI ?? true, model: options.model ?? codex,
		modelRegistry: {
			isUsingOAuth: () => oauth,
			getProviderAuth: () => { authCalls++; throw new Error("Unexpected credential lookup in extension test"); },
		},
		sessionManager: { getEntries: () => entries, getSessionId: () => sessionId },
		ui: {
			theme: { appearance: "dark", fg: (_color: string, text: string) => text, style: (text: string) => text },
			setStatus: (key: string, text: string | undefined) => { statuses.set(key, text); statusHistory.push({ key, text }); },
			notify: (message: string, type: string) => { notices.push({ message, type }); },
			select: async () => { selected++; throw new Error("Unexpected reset-card selection"); },
			custom: async (factory: Factory) => {
				let action: "use" | undefined;
				const panel = factory(tui, undefined, undefined, (value) => { action = value; });
				panels.push(panel);
				panel.handleInput("q");
				return action;
			},
		},
	};
	const ctx = rawContext as unknown as ExtensionCommandContext;
	const api = {
		on: (name: string, handler: Handler) => { events.set(name, handler); return () => events.delete(name); },
		registerCommand: (name: string, command: Command) => { commands.set(name, command); },
		appendEntry: (customType: string, data: Entry["data"]) => {
			if (appendFailure) throw new Error("Synthetic session write failure");
			entries.push({ type: "custom", customType, data });
		},
	} as unknown as ExtensionAPI;
	codexLimit(api);
	const fire = async (name: string, event: Record<string, unknown> = {}) => {
		const handler = events.get(name);
		return handler ? await handler({ type: name, ...event }, ctx) : undefined;
	};
	const command = async (name: string, args = "") => {
		const registered = commands.get(name);
		assert.ok(registered, `Missing /${name} command`);
		await registered.handler(args, ctx);
	};
	return { ctx, rawContext, tui, terminal, commands, entries, notices, panels, statuses, statusHistory, fire, command,
		get authCalls() { return authCalls; }, get selected() { return selected; }, get renders() { return renders; },
		setOAuth: (value: boolean) => { oauth = value; }, setSessionId: (value: string) => { sessionId = value; },
		failAppend: (value: boolean) => { appendFailure = value; },
		status: () => statuses.get("codex-limit"),
	};
}

async function start(h: ReturnType<typeof harness>, reason = "startup") {
	await h.fire("session_start", { reason });
	await tick();
}
const streamEvent = (tier?: string) => ({ provider: codex.provider, api: codex.api, model: codex.id,
	data: { type: "response.completed", response: { id: "synthetic-response", service_tier: tier } } });

test("only /fast on and off change Fast; commands run offline without looking up credentials", async () => {
	const h = harness();
	assert.deepEqual([...h.commands.keys()].sort(), ["codex-limit", "fast"]);
	await start(h);
	assert.ok(!h.status()?.includes("Fast"));
	await h.command("fast", " on ");
	assert.match(h.status()!, / · Fast$/);
	assert.deepEqual(h.entries, [{ type: "custom", customType: FAST_ENTRY, data: { enabled: true, sessionId: "session-A" } }]);
	assert.match(h.notices.at(-1)!.message, /2\.5 倍/);
	await h.command("fast", "off");
	assert.ok(!h.status()?.includes("Fast"));
	assert.equal(h.entries.at(-1)!.data.enabled, false);
	assert.equal(h.authCalls, 0);
	assert.equal(h.selected, 0);
	await h.fire("session_shutdown", { reason: "quit" });
});

test("bare /fast, status, toggle and invalid arguments cannot change the session preference", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	for (const argument of ["", "status", "toggle", "ON", "on off", "on\nextra"]) {
		await h.command("fast", argument);
		assert.match(h.notices.at(-1)!.message, /用法：\/fast on 或 \/fast off/);
		assert.equal(h.entries.length, 1);
		assert.match(h.status()!, / · Fast$/);
	}
	await h.command("codex-limit", "fast on");
	assert.match(h.notices.at(-1)!.message, /用法：\/codex-limit/);
	assert.equal(h.panels.length, 0);
	assert.equal(h.authCalls, 0);
});

test("failed session-entry persistence preserves the previous switch state in both directions", async () => {
	const h = harness();
	await start(h);
	h.failAppend(true);
	await h.command("fast", "on");
	assert.ok(!h.status()?.includes("Fast"));
	assert.equal(h.entries.length, 0);
	assert.match(h.notices.at(-1)!.message, /原状态保持不变/);
	h.failAppend(false);
	await h.command("fast", "on");
	h.failAppend(true);
	await h.command("fast", "off");
	assert.match(h.status()!, / · Fast$/);
	assert.equal(h.entries.length, 1);
});

test("unsupported or unknown catalog capability refuses /fast on without persisting a choice", async (t: TestContext) => {
	for (const kind of ["unsupported", "unknown"] as const) {
		t.mock.method(FastCatalog.prototype, "read", async () => ({ kind, reason: "Synthetic capability result" }));
		const h = harness();
		await start(h);
		await h.command("fast", "on");
		assert.equal(h.entries.length, 0);
		assert.ok(!h.status()?.includes(" · Fast"));
		assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "default" });
		assert.equal(h.notices.at(-1)!.type, "warning");
		assert.equal(h.authCalls, 0);
	}
});

test("restored preferences display unavailable or unknown capability and send default", async (t: TestContext) => {
	for (const kind of ["unsupported", "unknown"] as const) {
		t.mock.method(FastCatalog.prototype, "read", async () => ({ kind, reason: "Synthetic capability result" }));
		const entries: Entry[] = [{ type: "custom", customType: FAST_ENTRY, data: { enabled: true, sessionId: "session-A" } }];
		const h = harness({ entries });
		await start(h, "resume");
		assert.match(h.status()!, kind === "unknown" ? /Fast能力未知/ : /Fast不可用/);
		assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "default" });
		await h.command("fast", "on");
		assert.equal(entries.length, 1, "a refused command cannot replace the restored preference");
		await h.command("fast", "off");
		assert.equal(entries.at(-1)!.data.enabled, false);
		assert.ok(!h.status()?.includes("Fast"));
	}
});

test("/fast off and an off startup never query catalog or credentials even with the real offline catalog", async () => {
	mock.restoreAll();
	const h = harness();
	await start(h);
	await h.command("fast", "off");
	assert.equal(h.authCalls, 0);
	assert.equal(h.entries.at(-1)!.data.enabled, false);
	assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "default" });
});

test("late catalog results cannot override off, logout or model/session replacement", async (t: TestContext) => {
	for (const replacement of ["model", "new-session", "shutdown", "off", "logout", "logout-without-event"]) {
		let finish!: (value: { kind: "supported" }) => void;
		const waiting = new Promise<{ kind: "supported" }>((resolve) => { finish = resolve; });
		t.mock.method(FastCatalog.prototype, "read", () => waiting);
		const h = harness();
		await start(h);
		const command = h.command("fast", "on");
		await tick();
		if (replacement === "model") {
			h.rawContext.model = { ...codex, provider: "google" };
			await h.fire("model_select");
		} else if (replacement === "new-session") {
			h.setSessionId("session-B");
			await start(h, "new");
		} else if (replacement === "off") await h.command("fast", "off");
		else if (replacement === "logout") { h.setOAuth(false); await h.fire("model_select"); }
		else if (replacement === "logout-without-event") h.setOAuth(false);
		else await h.fire("session_shutdown", { reason: "quit" });
		finish({ kind: "supported" });
		await command;
		assert.equal(h.entries.length, replacement === "off" ? 1 : 0, `${replacement} invalidates the command's awaited catalog result`);
		if (replacement === "off") assert.equal(h.entries[0]!.data.enabled, false);
		assert.ok(!h.status()?.includes(" · Fast"));
	}
});

test("catalog support allows future model IDs and never relies on a hardcoded list", async (t: TestContext) => {
	const future = { ...codex, id: "gpt-synthetic-future" };
	const queried: (FastModel | undefined)[] = [];
	t.mock.method(FastCatalog.prototype, "read", async (model: FastModel | undefined) => {
		queried.push(model);
		return { kind: "supported" as const };
	});
	const h = harness({ model: future });
	await start(h);
	await h.command("fast", "on");
	assert.ok(queried.some((model) => model?.id === future.id));
	const futurePayload = { ...payload(), model: future.id };
	assert.deepEqual(await h.fire("before_provider_request", { payload: futurePayload }), { ...futurePayload, service_tier: "priority" });
	assert.match(h.status()!, / · Fast$/);
});

test("request-time catalog refresh uses default while capability is unknown or unavailable and recovers priority", async (t: TestContext) => {
	let kind: "supported" | "unsupported" | "unknown" = "supported";
	t.mock.method(FastCatalog.prototype, "read", async () => ({ kind }));
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	for (const next of ["unknown", "unsupported", "supported"] as const) {
		kind = next;
		const tier = next === "supported" ? "priority" : "default";
		assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: tier });
		assert.match(h.status()!, next === "unknown" ? /Fast能力未知/ : next === "unsupported" ? /Fast不可用/ : / · Fast$/);
		assert.equal(h.entries.length, 1, "capability changes must not change the saved preference");
	}
});

test("a slower older capability result cannot overwrite the newest request-time capability", async (t: TestContext) => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	let finish!: (value: { kind: "unknown" }) => void;
	const waiting = new Promise<{ kind: "unknown" }>((resolve) => { finish = resolve; });
	let calls = 0;
	t.mock.method(FastCatalog.prototype, "read", () => ++calls === 1 ? waiting : Promise.resolve({ kind: "supported" as const }));
	const older = h.fire("before_provider_request", { payload: payload() });
	await tick();
	assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "priority" });
	finish({ kind: "unknown" });
	assert.deepEqual(await older, { ...payload(), service_tier: "priority" });
	assert.match(h.status()!, / · Fast$/);
});

test("unofficial origins have no Codex status, payload rewriting or Fast command persistence", async () => {
	for (const baseUrl of ["https://proxy.invalid/backend-api", "https://api.openai.com/v1", "http://chatgpt.com/backend-api", "https://chatgpt.com.evil.invalid"]) {
		const h = harness({ model: { ...codex, baseUrl } });
		await start(h);
		assert.equal(h.status(), undefined);
		assert.equal(await h.fire("before_provider_request", { payload: payload() }), undefined);
		await h.command("fast", "on");
		assert.equal(h.entries.length, 0);
		assert.equal(h.authCalls, 0);
	}
});

test("new sessions and forks start off, while startup, resume and reload restore this session only", async () => {
	const entries: Entry[] = [];
	const h = harness({ entries });
	await start(h);
	await h.command("fast", "on");
	for (const reason of ["startup", "reload", "resume"]) {
		const restored = harness({ entries });
		await start(restored, reason);
		assert.match(restored.status()!, / · Fast$/);
		await restored.fire("session_shutdown", { reason: "reload" });
	}
	for (const reason of ["new", "fork"]) {
		h.setSessionId(`session-${reason}`);
		await start(h, reason);
		assert.ok(!h.status()?.includes("Fast"));
		assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "default" });
	}
	h.setSessionId("session-A");
	await start(h, "resume");
	assert.match(h.status()!, / · Fast$/);
	await h.command("fast", "off");
	await start(h, "reload");
	assert.ok(!h.status()?.includes("Fast"));
});

test("same-session tree navigation retains the session-wide preference", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	await h.fire("session_tree", { oldLeafId: "branch-A", newLeafId: "branch-B", fromExtension: false });
	assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "priority" });
	assert.equal(h.entries.length, 1);
});

test("switching providers hides the complete status and restores Fast only on return to subscription OAuth", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	for (const model of [{ ...codex, provider: "openai" }, { ...codex, provider: "anthropic" },
		{ ...codex, provider: "google" }, { ...codex, api: "openai-responses" }]) {
		h.rawContext.model = model;
		await h.fire("model_select");
		assert.equal(h.status(), undefined);
		assert.equal(await h.fire("before_provider_request", { payload: payload() }), undefined);
		await h.fire("provider_stream_event", streamEvent("fast"));
		await h.fire("agent_settled");
		assert.equal(h.status(), undefined);
		await h.command("fast", "on");
		assert.equal(h.entries.length, 1, "rejected on must not overwrite stored session preference");
		assert.match(h.notices.at(-1)!.message, /仅适用于.*Codex 订阅 OAuth/);
	}
	h.rawContext.model = codex;
	h.setOAuth(false);
	await h.fire("model_select");
	assert.equal(h.status(), undefined);
	assert.equal(await h.fire("before_provider_request", { payload: payload() }), undefined);
	await h.command("fast", "on");
	assert.equal(h.entries.length, 1);
	h.setOAuth(true);
	await h.fire("model_select");
	assert.match(h.status()!, / · Fast$/);
	assert.equal(h.authCalls, 0);
});

test("/fast off can clear the retained session preference while another provider is selected", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	h.rawContext.model = { ...codex, provider: "google" };
	await h.fire("model_select");
	await h.command("fast", "off");
	assert.equal(h.entries.at(-1)!.data.enabled, false);
	assert.equal(h.status(), undefined);
	h.rawContext.model = codex;
	await h.fire("model_select");
	assert.ok(!h.status()?.includes("Fast"));
});

test("provider request and stream events update Fast confirmation, fallback and unconfirmed status", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	for (const [tier, status] of [["fast", / · Fast$/], ["priority", / · Fast$/], ["default", / · Fast$/], [undefined, / · Fast$/]] as const) {
		const input = payload();
		const before = structuredClone(input);
		assert.deepEqual(await h.fire("before_provider_request", { payload: input }), { ...input, service_tier: "priority" });
		assert.deepEqual(input, before);
		assert.match(h.status()!, / · Fast$/);
		await h.fire("provider_stream_event", streamEvent(tier));
		assert.match(h.status()!, status);
		await h.fire("agent_settled");
		assert.match(h.status()!, status);
	}
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("agent_settled");
	assert.match(h.status()!, / · Fast$/);
	await h.fire("model_select");
	assert.match(h.status()!, / · Fast$/, "model selection cannot prove an unfinished response has stopped");
	await h.command("fast", "off");
	await h.fire("provider_stream_event", streamEvent("fast"));
	assert.ok(!h.status()?.includes("Fast"));
	assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "default" });
});

test("the supported Fast footer remains enabled while the panel reports a standard server response", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("provider_stream_event", streamEvent("default"));
	assert.match(h.status()!, / · Fast$/);
	await h.command("codex-limit");
	const detail = h.panels.at(-1)!.render(68).join("\n");
	assert.match(detail, /模型能力：支持 Fast/);
	assert.match(detail, /请求档位：priority/);
	assert.match(detail, /最近服务端档位：.*default/);
	assert.ok(!detail.includes("Fast 未生效"));
});

test("late quota callbacks from disposed controllers cannot make hidden status reappear", async (t: TestContext) => {
	const controllers: QuotaController[] = [];
	t.mock.method(QuotaController.prototype, "refresh", function(this: QuotaController) {
		controllers.push(this);
		return Promise.resolve(this.getState());
	});
	const h = harness();
	await start(h);
	const old = controllers[0]!;
	assert.ok(old);
	h.rawContext.model = { ...codex, provider: "anthropic" };
	await h.fire("model_select");
	const writes = h.statusHistory.length;
	const lateCallback = (old as unknown as { options: { onChange: (state: QuotaState) => void } }).options.onChange;
	lateCallback(old.getState());
	assert.equal(h.status(), undefined);
	assert.equal(h.statusHistory.length, writes);
	h.rawContext.model = codex;
	await h.fire("model_select");
	const currentStatus = h.status();
	const returnedWrites = h.statusHistory.length;
	lateCallback(old.getState());
	assert.equal(h.status(), currentStatus);
	assert.equal(h.statusHistory.length, returnedWrites);
	await h.fire("session_shutdown", { reason: "quit" });
	lateCallback(old.getState());
	assert.equal(h.status(), undefined);
});

test("overlapping, failed and incomplete stream diagnostics preserve the supported Fast footer", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("provider_stream_event", streamEvent("fast"));
	assert.match(h.status()!, / · Fast$/);
	await h.fire("agent_settled");
	await start(h, "reload"); // A fresh extension runtime clears ambiguous old streams.
	for (const type of ["response.failed", "response.incomplete"]) {
		await h.fire("before_provider_request", { payload: payload() });
		const event = streamEvent("fast");
		event.data.type = type;
		await h.fire("provider_stream_event", event);
		assert.match(h.status()!, / · Fast$/);
		await h.fire("agent_settled");
	}
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("provider_stream_event", streamEvent("fast"));
	assert.match(h.status()!, / · Fast$/);
});

test("supported Fast footer survives overlapping streams, settlement, toggles and model changes", async () => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("before_provider_request", { payload: payload() });
	assert.match(h.status()!, / · Fast$/);
	const foregroundA = streamEvent("fast");
	foregroundA.data.response.id = "foreground-A";
	await h.fire("provider_stream_event", foregroundA);
	await h.fire("agent_settled");
	await h.fire("before_provider_request", { payload: payload() });
	const oldBackground = streamEvent("fast");
	oldBackground.data.response.id = "late-background-W";
	await h.fire("provider_stream_event", oldBackground);
	assert.match(h.status()!, / · Fast$/);
	await h.command("fast", "off");
	assert.ok(!h.status()?.includes("Fast"));
	await h.command("fast", "on");
	assert.match(h.status()!, / · Fast$/);
	h.rawContext.model = { ...codex, provider: "google" };
	await h.fire("model_select");
	assert.equal(h.status(), undefined);
	h.rawContext.model = codex;
	await h.fire("model_select");
	assert.match(h.status()!, / · Fast$/);
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("provider_stream_event", streamEvent("fast"));
	assert.match(h.status()!, / · Fast$/);
	await start(h, "reload");
	assert.match(h.status()!, / · Fast$/);
	await h.fire("before_provider_request", { payload: payload() });
	await h.fire("provider_stream_event", streamEvent("fast"));
	assert.match(h.status()!, / · Fast$/);
});

test("supported Fast footer stays stable across unfinished requests and context events", async () => {
	for (const reset of ["off/on", "model_select", "agent_settled"]) {
		const h = harness();
		await start(h);
		await h.command("fast", "on");
		await h.fire("before_provider_request", { payload: payload() }); // A, no prior overlap.
		assert.match(h.status()!, / · Fast$/);
		if (reset === "off/on") { await h.command("fast", "off"); await h.command("fast", "on"); }
		else await h.fire(reset);
		assert.match(h.status()!, / · Fast$/);
		await h.fire("before_provider_request", { payload: payload() }); // B.
		const lateA = streamEvent("fast");
		lateA.data.response.id = "late-response-A";
		await h.fire("provider_stream_event", lateA);
		assert.match(h.status()!, / · Fast$/, `${reset} must not attribute A's old response to B`);
		await h.fire("before_provider_request", { payload: payload() });
		await start(h, "reload");
		assert.match(h.status()!, / · Fast$/);
		await h.fire("before_provider_request", { payload: payload() });
		await h.fire("provider_stream_event", streamEvent("fast"));
		assert.match(h.status()!, / · Fast$/);
	}
});

test("the detail panel is read-only for Fast, with only u retaining the reset action", async (t: TestContext) => {
	const h = harness();
	await start(h);
	await h.command("fast", "on");
	await h.command("codex-limit");
	const output = h.panels[0]!.render(68).join("\n");
	assert.match(output, /🍧 Codex 额度/);
	assert.match(output, /Fast 开关：开启/);
	assert.match(output, /使用 \/fast on 或 \/fast off/);
	assert.ok(!output.includes("f 切换"));
	const controller = new QuotaController({ offline: true, resolveAuth: async () => { throw new Error("Unexpected credential lookup"); } });
	const fast = new FastModeController();
	fast.setCapability({ kind: "supported" });
	fast.setEnabled(true);
	const actions: ("use" | undefined)[] = [];
	const panel = new QuotaPanel(h.tui, h.ctx, controller, (action) => actions.push(action), fast);
	panel.handleInput("f");
	assert.equal(fast.enabled, true);
	assert.deepEqual(actions, []);
	panel.handleInput("u");
	assert.deepEqual(actions, []);
	assert.match(h.notices.at(-1)!.message, /离线/);
	t.mock.method(controller, "getResetButton", () => ({ enabled: true, phase: "ready" as const, hint: "synthetic ready card" }));
	panel.handleInput("u");
	panel.handleInput("u");
	assert.deepEqual(actions, ["use"], "reset action is emitted exactly once and never consumed by the panel itself");
	assert.equal(h.selected, 0);
	assert.equal(h.authCalls, 0);
	controller.dispose();
});

test("panel scrolling and compact layouts remain within terminal size and show Fast", () => {
	const h = harness();
	const fast = new FastModeController();
	fast.setCapability({ kind: "supported" });
	fast.setEnabled(true);
	const controller = new QuotaController({ offline: true, resolveAuth: async () => { throw new Error("Unexpected credential lookup"); } });
	const panel = new QuotaPanel(h.tui, h.ctx, controller, () => {}, fast);
	for (const rows of [4, 8, 10, 16, 32]) {
		h.terminal.rows = rows;
		for (const width of [0, 1, 5, 12, 24, 40, 68, 90]) {
			const lines = panel.render(width);
			assert.ok(lines.length <= rows, `height overflow at ${width}x${rows}`);
			for (const line of lines) assert.ok(visibleWidth(line) <= Math.min(width, 68), `width overflow at ${width}x${rows}: ${line}`);
			if (width >= 24) assert.match(lines.join("\n"), /Fast/);
		}
	}
	h.terminal.rows = 16;
	panel.render(40);
	panel.handleInput("\x1b[B");
	panel.handleInput("\x1b[F");
	assert.ok(h.renders >= 1);
	assert.ok(panel.render(40).every((line) => visibleWidth(line) <= 40));
	panel.handleInput("\x1b[H");
	controller.dispose();
});

test("short terminals retain a readable Fast switch and server-tier summary", () => {
	const h = harness();
	h.terminal.rows = 8;
	const fast = new FastModeController();
	const controller = new QuotaController({ offline: true, resolveAuth: async () => { throw new Error("Unexpected credential lookup"); } });
	const panel = new QuotaPanel(h.tui, h.ctx, controller, () => {}, fast);
	assert.match(panel.render(40).join("\n"), /Fast 开关：关闭/);
	fast.setCapability({ kind: "supported" });
	fast.setEnabled(true);
	fast.transform(payload(), codex, true);
	fast.observe(streamEvent("fast"));
	let output = panel.render(40).join("\n");
	assert.match(output, /Fast 开关：开启/);
	assert.match(output, /模型能力：支持 Fast/);
	assert.match(output, /请求档位：priority/);
	for (let i = 0; i < 5; i++) { panel.handleInput("\x1b[B"); output += "\n" + panel.render(40).join("\n"); }
	assert.match(output, /最近服务端档位：Fast/);
	assert.ok(!output.includes("f 切换"));
	panel.handleInput("\x1b[B");
	assert.ok(h.renders >= 1);
	controller.dispose();
});

test("non-TUI and headless sessions never install a status bar", async () => {
	for (const options of [{ mode: "rpc" }, { hasUI: false }]) {
		const h = harness(options);
		await start(h);
		await h.command("fast", "on");
		assert.equal(h.statusHistory.length, 0);
		assert.deepEqual(await h.fire("before_provider_request", { payload: payload() }), { ...payload(), service_tier: "priority" });
		assert.equal(h.authCalls, 0);
		await h.fire("session_shutdown", { reason: "quit" });
	}
});
