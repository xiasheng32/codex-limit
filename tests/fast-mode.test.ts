import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_ENTRY, FastModeController, isCodexFastModel, isCodexSubscription, restoreFastMode } from "../src/fast-mode.ts";
import type { FastModel } from "../src/fast-mode.ts";

const model: FastModel = { id: "gpt-6.1-sol", provider: "openai-codex", api: "openai-codex-responses" };
const request = () => ({ model: model.id, input: [{ role: "user", content: "synthetic prompt" }],
	service_tier: "default", reasoning: { effort: "high" }, tools: [{ type: "function", name: "synthetic_tool" }],
	prompt_cache_key: "synthetic-cache", stream: true });
const entry = (enabled: boolean, sessionId = "session-A") => ({ type: "custom", customType: FAST_ENTRY, data: { enabled, sessionId } });
function event(tier: unknown, options: { type?: string; id?: string; model?: string; provider?: string; api?: string } = {}) {
	return { provider: options.provider ?? model.provider, api: options.api ?? model.api, model: options.model ?? model.id,
		data: { type: options.type ?? "response.completed", response: { id: options.id ?? "synthetic-response-A", service_tier: tier } } };
}

test("quota eligibility still requires OAuth, while Fast eligibility uses provider and API", () => {
	assert.equal(isCodexSubscription(model, true), true);
	assert.equal(isCodexFastModel(model), true);
	for (const candidate of [undefined, { ...model, provider: "openai" }, { ...model, provider: "anthropic" },
		{ ...model, provider: "google" }, { ...model, api: "openai-responses" }]) {
		assert.equal(isCodexSubscription(candidate, true), false);
		assert.equal(isCodexFastModel(candidate), false);
	}
	assert.equal(isCodexSubscription(model, false), false);
	assert.equal(isCodexFastModel(model), true, "Fast must not depend on Pi OAuth detection");
});

test("restoration uses the latest valid choice in this session and never inherits a fork", () => {
	const entries = [entry(true), entry(false), entry(true, "session-B")];
	assert.equal(restoreFastMode(entries, "session-A"), false);
	assert.equal(restoreFastMode([...entries, entry(true)], "session-A"), true);
	assert.equal(restoreFastMode(entries, "session-B"), true);
	assert.equal(restoreFastMode(entries, "fork-C"), false);
	assert.equal(restoreFastMode([], "session-A"), false);
});

test("malformed and unrelated custom entries cannot enable Fast", () => {
	const invalid = [null, [], 1, {}, { type: "message", customType: FAST_ENTRY, data: { enabled: true, sessionId: "session-A" } },
		{ ...entry(true), customType: "other-extension" }, { ...entry(true), data: { enabled: "true", sessionId: "session-A" } },
		{ ...entry(true), data: { enabled: true } }, { ...entry(true), data: [] }];
	assert.equal(restoreFastMode(invalid, "session-A"), false);
	assert.equal(restoreFastMode([entry(true), ...invalid], "session-A"), true);
});

test("Fast starts off and leaves even a preexisting service tier untouched", () => {
	const fast = new FastModeController();
	const payload = request();
	assert.equal(fast.enabled, false);
	assert.equal(fast.transform(payload, model), undefined);
	assert.equal(payload.service_tier, "default");
	assert.equal(fast.suffix(), "");
});

test("Fast replaces only service_tier while preserving model, reasoning, tools, cache and input", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	const payload = request();
	const before = structuredClone(payload);
	const transformed = fast.transform(payload, model);
	assert.deepEqual(transformed, { ...before, service_tier: "priority" });
	assert.deepEqual(payload, before, "the original provider payload is never mutated");
	assert.notEqual(transformed, payload);
	assert.equal(fast.phase, "requested");
	assert.equal(fast.suffix(), " · Fast待确认");
});

test("non-Codex models and unrelated payloads stay unchanged", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	for (const candidate of [{ ...model, provider: "openai" }, { ...model, provider: "anthropic" }, { ...model, api: "other-api" }, undefined]) {
		assert.equal(fast.transform(request(), candidate), undefined);
	}
	for (const payload of [null, [], "text", {}, { ...request(), model: "other-model" }, { ...request(), model: "different" }]) {
		assert.equal(fast.transform(payload, model), undefined);
	}
	assert.equal(fast.phase, "idle");
});

test("valid Codex provider payloads are decorated even without an input array", () => {
	for (const payload of [{ model: model.id }, { model: model.id, input: "pre-serialized" }]) {
		const fast = new FastModeController();
		fast.setEnabled(true);
		assert.deepEqual(fast.transform(payload, model), { ...payload, service_tier: "priority" });
		assert.ok(!Object.hasOwn(payload, "service_tier"));
	}
});

test("Fast confirmation, standard fallback and missing or unknown tiers are distinguished", () => {
	for (const [tier, phase, suffix] of [["fast", "fast", " · Fast"], ["priority", "fast", " · Fast"],
		["default", "standard", " · Fast未生效"], [undefined, "unknown", " · Fast未确认"], ["auto", "unknown", " · Fast未确认"]]) {
		const fast = new FastModeController();
		fast.setEnabled(true);
		fast.transform(request(), model);
		fast.observe(event(tier));
		assert.equal(fast.phase, phase);
		assert.equal(fast.suffix(), suffix);
	}
});

test("response identity and provider/model filtering prevent unrelated completion from confirming Fast", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	fast.transform(request(), model);
	fast.observe(event("fast", { type: "response.created" }));
	assert.equal(fast.phase, "requested", "an early tier is not a completed response confirmation");
	for (const options of [{ id: "synthetic-response-B" }, { provider: "openai" }, { api: "other-api" }, { model: "other-model" }]) {
		fast.observe(event("fast", options));
		assert.equal(fast.phase, "requested");
	}
	fast.observe(event("default"));
	assert.equal(fast.phase, "standard");
	fast.observe(event("fast"));
	assert.equal(fast.phase, "standard", "a settled request cannot be overwritten by a late event");
});

test("invalid stream data and unfinished requests never claim acceleration", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	fast.transform(request(), model);
	for (const data of [undefined, null, [], {}, { type: "response.completed", response: [] }]) {
		fast.observe({ ...event("fast"), data });
	}
	assert.equal(fast.phase, "requested");
	fast.settle();
	assert.equal(fast.phase, "unknown");
	fast.observe(event("fast"));
	assert.equal(fast.phase, "unknown");
});

test("overlapping cache-warming and foreground responses remain unconfirmed across turns until session reset", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	assert.deepEqual(fast.transform(request(), model), { ...request(), service_tier: "priority" });
	assert.deepEqual(fast.transform(request(), model), { ...request(), service_tier: "priority" });
	fast.observe(event("fast", { id: "cache-response" }));
	assert.equal(fast.phase, "unknown");
	fast.observe(event("priority", { id: "foreground-response" }));
	assert.equal(fast.phase, "unknown");
	fast.transform(request(), model);
	fast.observe(event("fast", { id: "third-response" }));
	assert.equal(fast.phase, "unknown", "the ambiguous turn must remain conservative for later streams too");
	fast.settle();
	fast.transform(request(), model);
	fast.observe(event("fast", { id: "next-turn-response" }));
	assert.equal(fast.phase, "unknown", "agent settlement cannot establish that a background stream has ended");
	fast.resetSession(true);
	fast.transform(request(), model);
	fast.observe(event("fast", { id: "new-runtime-response" }));
	assert.equal(fast.phase, "fast", "a fresh session runtime can confirm Fast again");
});

test("a late background completion cannot confirm a later turn after settle, toggles or model changes", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	fast.transform(request(), model); // Foreground A.
	fast.transform(request(), model); // Background cache warming W.
	assert.equal(fast.phase, "unknown", "overlap is unconfirmed immediately, before either stream completes");
	fast.observe(event("fast", { id: "foreground-A" }));
	fast.settle();
	fast.transform(request(), model); // Foreground B.
	fast.observe(event("fast", { id: "late-background-W" }));
	assert.equal(fast.phase, "unknown", "W must not be mistaken for B after agent settlement");
	for (const reset of [() => fast.settle(), () => { fast.setEnabled(false); fast.setEnabled(true); }, () => fast.resetResponse()]) {
		reset();
		assert.equal(fast.phase, "unknown");
		fast.transform(request(), model);
		assert.equal(fast.phase, "unknown");
		fast.observe(event("fast", { id: "another-late-background" }));
		assert.equal(fast.phase, "unknown");
	}
	fast.resetSession(false);
	assert.equal(fast.enabled, false);
	assert.equal(fast.phase, "idle");
	fast.setEnabled(true);
	fast.transform(request(), model);
	fast.observe(event("fast", { id: "new-session-foreground" }));
	assert.equal(fast.phase, "fast");
});

test("failed and incomplete responses remain unconfirmed even when a Fast tier is present", () => {
	for (const type of ["response.failed", "response.incomplete"]) {
		const fast = new FastModeController();
		fast.setEnabled(true);
		fast.transform(request(), model);
		fast.observe(event("fast", { type }));
		assert.equal(fast.phase, "unknown");
		assert.equal(fast.suffix(), " · Fast未确认");
		assert.match(fast.details(model).join("\n"), /请求失败/);
	}
});

test("clearing a pending request retains ambiguity even when no requests previously overlapped", () => {
	for (const reset of ["off/on", "resetResponse", "settle", "on-again"]) {
		const fast = new FastModeController();
		fast.setEnabled(true);
		fast.transform(request(), model); // A is the only request so far.
		assert.equal(fast.phase, "requested");
		if (reset === "off/on") { fast.setEnabled(false); fast.setEnabled(true); }
		else if (reset === "on-again") fast.setEnabled(true);
		else if (reset === "resetResponse") fast.resetResponse();
		else fast.settle();
		assert.equal(fast.phase, "unknown", `${reset} cannot prove A has finished`);
		fast.transform(request(), model); // B starts after A was forgotten.
		fast.observe(event("fast", { id: "late-response-A" }));
		assert.equal(fast.phase, "unknown", `${reset} must not attribute late A to B`);
		fast.transform(request(), model); // Keep another pending request at runtime reset.
		fast.resetSession(true);
		assert.equal(fast.phase, "idle", "session reset clears pending evidence without latching it again");
		fast.transform(request(), model);
		fast.observe(event("fast", { id: "fresh-runtime-response" }));
		assert.equal(fast.phase, "fast");
	}
});

test("turn settlement retains confirmed tiers but toggles and model changes clear old response state", () => {
	const fast = new FastModeController();
	fast.setEnabled(true);
	fast.transform(request(), model);
	fast.observe(event("fast"));
	fast.settle();
	assert.equal(fast.phase, "fast");
	fast.resetResponse();
	assert.equal(fast.enabled, true);
	assert.equal(fast.phase, "idle");
	fast.observe(event("fast"));
	assert.equal(fast.phase, "idle");
	fast.setEnabled(false);
	assert.equal(fast.suffix(), "");
	fast.observe(event("fast"));
	assert.equal(fast.phase, "idle");
});

test("details describe the session-only switch and sanitize terminal-control model names", () => {
	const fast = new FastModeController();
	assert.match(fast.details(model).join("\n"), /关闭（仅当前会话）/);
	fast.setEnabled(true);
	assert.match(fast.details(model).join("\n"), /2\.5 倍/);
	assert.match(fast.details(model).join("\n"), /\/fast on 或 \/fast off；新会话默认关闭/);
	assert.match(fast.details({ ...model, provider: "openai" }).join("\n"), /当前模型未应用/);
	const detail = fast.details({ ...model, id: "bad\x1b[31m\r\nmodel" }).join("\n");
	assert.match(detail, /未知模型/);
	assert.ok(!detail.includes("\x1b"));
});
