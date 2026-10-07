import assert from "node:assert/strict";
import { test } from "node:test";
import {
	API_URL, detailLines, extractAccountId, isOffline, parseQuota, parseRetryAfter,
	QuotaController, resetRemaining, statusLine, THROTTLE_MS, TIMEOUT_MS, windowLabel,
	RESET_CREDITS_URL, parseResetCredits, quotaBar,
} from "../src/quota.ts";

// Tripwire: tests must never fall through to a real account/network request.
globalThis.fetch = async () => { throw new Error("Unexpected live fetch in offline test"); };
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}
function token(accountId = "synthetic-account-A") {
	return [
		Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
		Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId }, note: "合成数据" })).toString("base64url"),
		"synthetic-signature",
	].join(".");
}
const oauth = (id) => ({ source: "OAuth", auth: { apiKey: token(id) } });
function payload() {
	return {
		plan_type: "plus",
		rate_limit: {
			allowed: true, limit_reached: false,
			primary_window: { used_percent: 22, limit_window_seconds: 18000, reset_at: NOW / 1000 + 7200, reset_after_seconds: 7200 },
			secondary_window: { used_percent: 36, limit_window_seconds: 604800, reset_at: NOW / 1000 + 259200 },
		},
	};
}
function resetPayload() {
	return {
		available_count: 2, total_earned_count: 4,
		credits: [
			{ id: "synthetic-credit-secret", reset_type: "codex_rate_limits", status: "available", granted_at: "2026-09-23T21:00:00Z", expires_at: "2026-10-22T21:00:00Z" },
			{ reset_type: "codex_rate_limits", status: "available", expires_at: "2026-10-29T18:34:00Z" },
			{ status: "redeemed", redeemed_at: "2026-10-01T12:00:00Z" },
			{ status: "expired", expires_at: "2026-10-01T00:00:00Z" },
		],
	};
}
function ready(snapshot) {
	return { phase: "ready", snapshot, lastAttemptAt: NOW, lastSuccessAt: NOW, stale: false, retryAt: null, error: null };
}
function harness({ auth = async () => oauth(), transport = async () => Response.json(payload()), resetTransport = async () => Response.json(resetPayload()), offline = false, timeoutSignal } = {}) {
	let time = NOW;
	let authCalls = 0;
	const requests = [];
	const resetRequests = [];
	const changes = [];
	const controller = new QuotaController({
		now: () => time,
		resolveAuth: async () => { authCalls++; return auth(); },
		fetch: async (url, init) => {
			if (url === RESET_CREDITS_URL) { resetRequests.push({ url, init }); return resetTransport(url, init); }
			requests.push({ url, init }); return transport(url, init);
		},
		onChange: (state) => changes.push(state),
		offline, timeoutSignal,
	});
	return {
		controller, requests, resetRequests, changes,
		advance: (milliseconds) => { time += milliseconds; },
		get now() { return time; },
		get authCalls() { return authCalls; },
	};
}
function assertSanitized(state, ...secrets) {
	const output = JSON.stringify(state) + detailLines(state, NOW).join("\n") + statusLine(state, NOW).text;
	for (const secret of secrets) assert.ok(!output.includes(secret), "State and UI must not contain authentication/provider secrets");
}

test("reset cards parse known metadata and discard all account/credit secrets", () => {
	const data = resetPayload();
	data.credits[0].title = "synthetic-title-secret\u001b[31m";
	data.credits[0].description = "synthetic-description-secret";
	const cards = parseResetCredits(data, NOW);
	assert.equal(cards.availableCount, 2);
	assert.equal(cards.totalEarnedCount, 4);
	assert.deepEqual(cards.credits.map((card) => card.status), ["available", "available", "used", "expired"]);
	assert.equal(cards.credits[0].expiresAt, Date.parse("2026-10-22T21:00:00Z"));
	assert.equal(cards.credits[2].redeemedAt, Date.parse("2026-10-01T12:00:00Z"));
	const state = { ...ready(parseQuota(payload(), NOW)), resetCredits: { snapshot: cards, stale: false, error: null, retryAt: null } };
	assert.equal(statusLine(state, NOW).text, "🦖 Codex 额度：( Plus | 5h 78% 7d 64% )");
	const detail = detailLines(state, NOW).join("\n");
	assert.match(detail, /可用 2 张/);
	assert.match(detail, /已用 1 张 · 已过期 1 张/);
	assert.match(detail, /完全重置（7d \+ 5h）/);
	assert.match(detail, /仅显示接口返回记录/);
	assertSanitized(state, "synthetic-credit-secret", "synthetic-title-secret", "synthetic-description-secret", "\u001b");
});

test("missing card count, missing history and zero cards are different states", () => {
	for (const bad of [null, {}, { available_count: -1 }, { available_count: "2" }, { available_count: 2, credits: {} }, { credits: [null] }]) {
		assert.throws(() => parseResetCredits(bad, NOW));
	}
	assert.equal(parseResetCredits({ credits: [{ status: "available" }] }, NOW).availableCount, null);
	assert.equal(parseResetCredits({ available_count: 0 }, NOW).credits, null);
	assert.deepEqual(parseResetCredits({ data: { available_count: 0, credits: [] } }, NOW).credits, []);
	const data = payload();
	data.rate_limit_reset_credits = { available_count: 2 };
	const state = ready(parseQuota(data, NOW));
	assert.match(detailLines(state, NOW).join("\n"), /可用 2 张/);
	assert.match(detailLines(state, NOW).join("\n"), /未提供使用记录/);
});

test("unknown card statuses/dates never masquerade as available or unlimited", () => {
	const cards = parseResetCredits({ credits: [{ status: "raw-secret", expires_at: "tomorrow", granted_at: "2026-10-07T12:00:00" }] }, NOW);
	assert.equal(cards.credits[0].status, "unknown");
	assert.equal(cards.credits[0].expiresAt, null);
	assert.equal(cards.credits[0].grantedAt, null);
	const state = { ...ready(parseQuota(payload(), NOW)), resetCredits: { snapshot: cards, stale: false } };
	assert.match(detailLines(state, NOW).join("\n"), /状态未知/);
	assert.match(detailLines(state, NOW).join("\n"), /有效期未知/);
	assertSanitized(state, "raw-secret");
});

test("progress bars show remaining quota and stay bounded on narrow layouts", () => {
	assert.equal(quotaBar(0, 12), "░".repeat(12));
	assert.equal(quotaBar(100, 12), "█".repeat(12));
	assert.equal(quotaBar(50, 12), "█".repeat(6) + "░".repeat(6));
	assert.match(detailLines(ready(parseQuota(payload(), NOW)), NOW, 12).join("\n"), /[█░]{12}/);
});

test("card endpoint errors do not hide successfully fetched usage", async () => {
	for (const status of [404, 500]) {
		const h = harness({ resetTransport: async () => new Response("synthetic-card-body-secret", { status }) });
		const state = await h.controller.refresh();
		assert.equal(state.phase, "ready");
		assert.equal(state.stale, false);
		assert.equal(state.resetCredits.snapshot, null);
		assert.equal(state.resetCredits.error.httpStatus, status);
		assert.match(detailLines(state, NOW).join("\n"), /可用 未知/);
		assertSanitized(state, "synthetic-card-body-secret");
		h.controller.dispose();
	}
});

test("card failures retain explicitly stale cards and have independent backoff", async () => {
	let fail = false;
	const h = harness({ resetTransport: async () => {
		if (fail) throw new Error("synthetic-reset-secret");
		return Response.json(resetPayload());
	} });
	await h.controller.refresh();
	fail = true;
	h.advance(THROTTLE_MS);
	const state = await h.controller.refresh();
	assert.equal(state.phase, "ready");
	assert.equal(state.resetCredits.stale, true);
	assert.match(detailLines(state, h.now).join("\n"), /可用 2 张 \[过期缓存\]/);
	assert.match(detailLines(state, h.now).join("\n"), /明细为过期缓存/);
	assertSanitized(state, "synthetic-reset-secret");
	h.advance(THROTTLE_MS);
	await h.controller.refresh();
	assert.equal(h.requests.length, 3);
	assert.equal(h.resetRequests.length, 2);
	fail = false;
	await h.controller.refresh(true);
	assert.equal(h.controller.getState().resetCredits.stale, false);
	h.controller.dispose();
});

test("card 429 cooldown cannot be bypassed by force, while usage stays fresh", async () => {
	const h = harness({ resetTransport: async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }) });
	await h.controller.refresh();
	await h.controller.refresh(true);
	assert.equal(h.requests.length, 2);
	assert.equal(h.resetRequests.length, 1);
	assert.equal(h.controller.getState().phase, "ready");
	h.advance(120_000);
	await h.controller.refresh(true);
	assert.equal(h.resetRequests.length, 2);
	h.controller.dispose();
});

test("card auth failure and account changes clear both usage and card caches", async () => {
	let id = "synthetic-account-A";
	let status = 200;
	const h = harness({ auth: async () => oauth(id), resetTransport: async () => status === 200 ? Response.json(resetPayload()) : new Response("", { status }) });
	await h.controller.refresh();
	id = "synthetic-account-B";
	status = 404;
	let state = await h.controller.refresh(true);
	assert.equal(state.resetCredits.snapshot, null);
	status = 401;
	state = await h.controller.refresh(true);
	assert.equal(state.phase, "auth_error");
	assert.equal(state.snapshot, null);
	assert.equal(state.resetCredits.snapshot, null);
	h.controller.dispose();
});

test("card timeout keeps usage ready and shutdown cancels in-flight card reads", async () => {
	const timeout = new AbortController();
	let timeouts = 0;
	const h = harness({ resetTransport: () => new Promise(() => {}), timeoutSignal: () => ++timeouts === 1 ? new AbortController().signal : timeout.signal });
	const pending = h.controller.refresh();
	await tick();
	assert.equal(h.resetRequests.length, 1);
	timeout.abort(new DOMException("Synthetic card timeout", "TimeoutError"));
	const state = await pending;
	assert.equal(state.phase, "ready");
	assert.equal(state.resetCredits.error.kind, "timeout");
	h.controller.dispose();
	const h2 = harness({ resetTransport: () => new Promise(() => {}) });
	const pending2 = h2.controller.refresh();
	await tick();
	h2.controller.dispose();
	await pending2;
	assert.equal(h2.resetRequests[0].init.signal.aborted, true);
	assert.equal(h2.controller.getState().resetCredits.snapshot, null);
});

test("22% used becomes 78% remaining; reset_at is Unix seconds", () => {
	const snapshot = parseQuota(payload(), NOW);
	assert.deepEqual(snapshot.windows.map((window) => window.remainingPercent), [78, 64]);
	assert.equal(snapshot.windows[0].resetAt, NOW + 7200_000);
	assert.equal(statusLine(ready(snapshot), NOW).text, "🦖 Codex 额度：( Plus | 5h 78% 7d 64% )");
	assert.match(detailLines(ready(snapshot), NOW).join("\n"), /7d .*剩64%/);
});

test("compact HUD preserves percentages while details keep reset countdowns", () => {
	const data = payload();
	data.rate_limit.primary_window.used_percent = 24;
	data.rate_limit.primary_window.reset_at = NOW / 1000 + 11 * 60;
	data.rate_limit.secondary_window.used_percent = 4;
	data.rate_limit.secondary_window.reset_at = NOW / 1000 + (6 * 24 + 19) * 3600;
	const state = ready(parseQuota(data, NOW));
	assert.equal(statusLine(state, NOW).text, "🦖 Codex 额度：( Plus | 5h 76% 7d 96% )");
	assert.match(detailLines(state, NOW).join("\n"), /↻ 11m 后重置/);
	assert.match(detailLines(state, NOW).join("\n"), /↻ 6d19h 后重置/);
	assert.match(statusLine({ ...state, phase: "loading" }, NOW).text, /^🦖 Codex\[更新中\] 额度：\(/);
	assert.match(statusLine({ ...state, snapshot: { ...state.snapshot, allowed: false } }, NOW).text, / \| 受限 \)$/);
});

test("compact HUD displays the live plan and quota percentages only", () => {
	const data = payload();
	data.rate_limit.primary_window.used_percent = 13;
	data.rate_limit.primary_window.reset_at = NOW / 1000 + (4 * 60 + 34) * 60;
	data.rate_limit.secondary_window.used_percent = 7;
	data.rate_limit.secondary_window.reset_at = NOW / 1000 + (6 * 24 + 18) * 3600;
	data.rate_limit_reset_credits = { available_count: 2 };
	assert.equal(statusLine(ready(parseQuota(data, NOW)), NOW).text,
		"🦖 Codex 额度：( Plus | 5h 87% 7d 93% )");
	data.plan_type = "pro";
	data.rate_limit_reset_credits.available_count = 0;
	assert.match(statusLine(ready(parseQuota(data, NOW)), NOW).text, /\( Pro \| 5h 87% 7d 93% \)/);
	delete data.plan_type;
	delete data.rate_limit_reset_credits;
	assert.match(statusLine(ready(parseQuota(data, NOW)), NOW).text, /\( 套餐未知 \| 5h 87% 7d 93% \)/);
});

test("compact HUD omits reset cards, countdowns and subscription expiry", () => {
	const state = { ...ready(parseQuota(payload(), NOW)), resetCredits: { snapshot: parseResetCredits(resetPayload(), NOW), stale: false } };
	assert.doesNotMatch(statusLine(state, NOW).text, /重置卡|↻|订阅到期|->/);
	assert.match(detailLines(state, NOW).join("\n"), /可用 2 张/);
});

test("a lone primary weekly window is not mislabeled 5h; extra quotas are not mixed in", () => {
	const data = payload();
	data.rate_limit.primary_window = data.rate_limit.secondary_window;
	data.rate_limit.secondary_window = null;
	data.additional_rate_limits = [{ rate_limit: { primary_window: { used_percent: 99 } } }];
	const snapshot = parseQuota(data, NOW);
	assert.equal(snapshot.windows.length, 1);
	assert.equal(windowLabel(snapshot.windows[0]), "7d");
	assert.equal(statusLine(ready(snapshot), NOW).text, "🦖 Codex 额度：( Plus | 7d 64% )");
	assert.doesNotMatch(statusLine(ready(snapshot), NOW).text, /5h|1%/);
});

test("other window lengths are displayed honestly instead of hardcoded as weekly", () => {
	const data = payload();
	data.rate_limit.primary_window.limit_window_seconds = 2628000;
	assert.equal(windowLabel(parseQuota(data, NOW).windows[0]), "30d10h");
	delete data.rate_limit.primary_window.limit_window_seconds;
	assert.equal(windowLabel(parseQuota(data, NOW).windows[0]), "主窗口");
});

test("valid null/absent/empty windows mean no data, not zero or unlimited", () => {
	for (const data of [
		{ plan_type: "enterprise", rate_limit: null }, { plan_type: "enterprise" },
		{ rate_limit: {} }, { rate_limit: { primary_window: null, secondary_window: null } },
	]) {
		const state = ready(parseQuota(data, NOW));
		assert.equal(state.snapshot.windows.length, 0);
		assert.match(statusLine(state, NOW).text, /暂无主额度数据/);
		assert.doesNotMatch(statusLine(state, NOW).text, /0%|100%|无限/);
	}
});

test("malformed responses and missing/non-numeric percentages are rejected", () => {
	const bad = [null, [], {}, { error: "synthetic-secret" }, { rate_limit: "bad" }];
	for (const percent of [undefined, null, "22", NaN, Infinity, -1]) {
		bad.push({ rate_limit: { primary_window: { used_percent: percent } } });
	}
	bad.push({ rate_limit: { allowed: "true" } });
	for (const data of bad) assert.throws(() => parseQuota(data, NOW));
	const over = { rate_limit: { primary_window: { used_percent: 110 } } };
	assert.equal(parseQuota(over, NOW).windows[0].remainingPercent, 0);
});

test("relative reset fallback is anchored to receipt time, only when reset_at is absent", () => {
	const data = { rate_limit: { primary_window: { used_percent: 22, reset_after_seconds: 120 } } };
	let snapshot = parseQuota(data, NOW);
	assert.equal(snapshot.windows[0].resetAt, NOW + 120_000);
	assert.equal(resetRemaining(snapshot.windows[0].resetAt, NOW + 60_000), "1m");
	data.rate_limit.primary_window.reset_at = "invalid";
	snapshot = parseQuota(data, NOW);
	assert.equal(snapshot.windows[0].resetAt, null);
	assert.equal(resetRemaining(null, NOW), "未知");
	data.rate_limit.primary_window.reset_at = NOW / 1000 - 1;
	snapshot = parseQuota(data, NOW);
	assert.equal(snapshot.windows[0].remainingPercent, 78);
	assert.match(detailLines(ready(snapshot), NOW).join("\n"), /待刷新/);
	assert.equal(statusLine(ready(snapshot), NOW).color, "warning");
});

test("display labels cannot inject terminal control characters", () => {
	const data = payload();
	data.plan_type = "pro\u001b[31m";
	const state = ready(parseQuota(data, NOW));
	assert.equal(state.snapshot.plan, null);
	assert.ok(!detailLines(state, NOW).join("\n").includes("\u001b"));
});

test("JWT base64url account routing accepts synthetic claims but rejects malformed/header-injection data", () => {
	assert.equal(extractAccountId(token()), "synthetic-account-A");
	for (const bad of ["sk-synthetic", "a.!.b", "a.e30.b", token("bad\r\nheader"), token(""), `${token()}.extra`]) {
		assert.equal(extractAccountId(bad), undefined);
	}
});

test("only the two fixed read-only endpoints receive OAuth headers, with redirects disabled", async () => {
	const h = harness();
	const state = await h.controller.refresh();
	assert.equal(state.phase, "ready");
	assert.equal(h.authCalls, 1);
	assert.equal(h.requests.length, 1);
	const { url, init } = h.requests[0];
	assert.equal(url, API_URL);
	assert.equal(init.method, "GET");
	assert.equal(init.redirect, "error");
	assert.equal(init.headers.Authorization, `Bearer ${token()}`);
	assert.equal(init.headers["ChatGPT-Account-Id"], "synthetic-account-A");
	assert.equal(init.headers.Accept, "application/json");
	assert.equal(h.resetRequests.length, 1);
	assert.equal(h.resetRequests[0].url, RESET_CREDITS_URL);
	assert.equal(h.resetRequests[0].init.method, "GET");
	assert.equal(h.resetRequests[0].init.redirect, "error");
	assert.deepEqual(h.resetRequests[0].init.headers, init.headers);
	assertSanitized(state, token(), "synthetic-account-A", "synthetic-credit-secret");
	h.controller.dispose();
});

test("offline flags prevent even credential resolution, including forced refresh", async () => {
	for (const value of ["1", "true", "yes", " YES "]) assert.equal(isOffline(value), true);
	for (const value of [undefined, "0", "false", "no"]) assert.equal(isOffline(value), false);
	const h = harness({ offline: true, auth: async () => { throw new Error("Must not resolve auth"); } });
	assert.equal((await h.controller.refresh(true)).phase, "offline");
	assert.equal(h.authCalls, 0);
	assert.equal(h.requests.length, 0);
});

test("logout clears cached account data without making another HTTP request", async () => {
	let loggedIn = true;
	const h = harness({ auth: async () => loggedIn ? oauth() : undefined });
	await h.controller.refresh();
	loggedIn = false;
	const state = await h.controller.refresh(true);
	assert.equal(state.phase, "not_logged_in");
	assert.equal(state.snapshot, null);
	assert.equal(state.lastSuccessAt, null);
	assert.equal(h.requests.length, 1);
	h.controller.dispose();
});

test("API keys and invalid OAuth claims never reach the usage endpoint", async () => {
	for (const auth of [{ source: "API key", auth: { apiKey: "synthetic-api-key" } }, { source: "OAuth", auth: { apiKey: "invalid-token" } }]) {
		const h = harness({ auth: async () => auth });
		const state = await h.controller.refresh();
		assert.equal(state.phase, "auth_error");
		assert.equal(h.requests.length, 0);
		assertSanitized(state, auth.auth.apiKey);
		h.controller.dispose();
	}
});

test("host OAuth errors are distinguished from missing login and fully sanitized", async () => {
	const secret = "synthetic-refresh-secret";
	const h = harness({ auth: async () => { throw new Error(`OAuth response: {refresh_token:${secret}}`); } });
	const state = await h.controller.refresh();
	assert.equal(state.phase, "auth_error");
	assert.equal(state.error.kind, "auth");
	assert.equal(h.requests.length, 0);
	assert.match(detailLines(state, NOW).join("\n"), /续期失败/);
	assertSanitized(state, secret, "OAuth response");
});

test("concurrent automatic/manual refreshes share one auth resolution and one request", async () => {
	const auth = deferred();
	const h = harness({ auth: () => auth.promise });
	const first = h.controller.refresh();
	const second = h.controller.refresh(true);
	assert.equal(first, second);
	await tick();
	assert.equal(h.authCalls, 1);
	assert.equal(h.requests.length, 0);
	auth.resolve(oauth());
	await Promise.all([first, second]);
	assert.equal(h.requests.length, 1);
	h.controller.dispose();
});

test("automatic refresh is throttled from attempt time, while manual refresh bypasses normal TTL", async () => {
	const h = harness();
	await h.controller.refresh();
	h.advance(THROTTLE_MS - 1);
	await h.controller.refresh();
	assert.equal(h.requests.length, 1);
	await h.controller.refresh(true);
	assert.equal(h.requests.length, 2);
	h.advance(THROTTLE_MS);
	await h.controller.refresh();
	assert.equal(h.requests.length, 3);
	h.controller.dispose();
});

test("network failure preserves a visibly stale cache and backs off failed attempts", async () => {
	let fail = false;
	const h = harness({ transport: async () => {
		if (fail) throw new Error("synthetic-network-secret");
		return Response.json(payload());
	} });
	await h.controller.refresh();
	fail = true;
	h.advance(THROTTLE_MS);
	const state = await h.controller.refresh();
	assert.equal(state.phase, "network_error");
	assert.equal(state.snapshot.windows[0].remainingPercent, 78);
	assert.equal(state.stale, true);
	assert.equal(state.lastSuccessAt, NOW);
	assert.match(statusLine(state, h.now).text, /^🦖 Codex\[过期\] 额度：\(/);
	assertSanitized(state, "synthetic-network-secret");
	h.advance(59_999);
	await h.controller.refresh();
	assert.equal(h.requests.length, 2);
	fail = false;
	h.advance(1);
	assert.equal((await h.controller.refresh()).phase, "ready");
	assert.equal(h.requests.length, 3);
	h.controller.dispose();
});

test("automatic error backoff is capped at five minutes", async () => {
	const h = harness({ transport: async () => { throw new Error("offline"); } });
	for (const delay of [60_000, 120_000, 240_000, 300_000, 300_000]) {
		const state = await h.controller.refresh();
		assert.equal(state.retryAt - h.now, delay);
		h.advance(delay);
	}
	h.controller.dispose();
});

test("Retry-After supports seconds and HTTP dates and rejects invalid values", () => {
	assert.equal(parseRetryAfter("120", NOW), NOW + 120_000);
	assert.equal(parseRetryAfter(new Date(NOW + 120_000).toUTCString(), NOW), NOW + 120_000);
	for (const value of [null, "", "garbage", "-1", "Infinity"]) assert.equal(parseRetryAfter(value, NOW), undefined);
});

test("429 cooldown blocks manual refresh too, then permits recovery", async () => {
	let limited = false;
	const h = harness({ transport: async () => limited
		? new Response("synthetic-provider-secret", { status: 429, headers: { "Retry-After": "120" } })
		: Response.json(payload()) });
	await h.controller.refresh();
	limited = true;
	const state = await h.controller.refresh(true);
	assert.equal(state.phase, "rate_limited");
	assert.equal(state.stale, true);
	assert.equal(state.retryAt, NOW + 120_000);
	assertSanitized(state, "synthetic-provider-secret");
	h.advance(119_999);
	await h.controller.refresh(true);
	assert.equal(h.requests.length, 2);
	limited = false;
	h.advance(1);
	assert.equal((await h.controller.refresh(true)).phase, "ready");
	assert.equal(h.requests.length, 3);
	h.controller.dispose();
});

test("401/403 clear old quotas and ask for pi login without echoing response bodies", async () => {
	for (const status of [401, 403]) {
		let fail = false;
		const h = harness({ transport: async () => fail ? new Response("synthetic-auth-body", { status }) : Response.json(payload()) });
		await h.controller.refresh();
		fail = true;
		const state = await h.controller.refresh(true);
		assert.equal(state.phase, "auth_error");
		assert.equal(state.snapshot, null);
		assert.equal(state.lastSuccessAt, null);
		assert.match(detailLines(state, NOW).join("\n"), /\/login openai-codex/);
		assertSanitized(state, "synthetic-auth-body");
		h.controller.dispose();
	}
});

test("account changes discard the previous account cache even if the new fetch fails", async () => {
	let id = "synthetic-account-A";
	const h = harness({ auth: async () => oauth(id), transport: async () => {
		if (id === "synthetic-account-B") throw new Error("offline");
		return Response.json(payload());
	} });
	await h.controller.refresh();
	id = "synthetic-account-B";
	const state = await h.controller.refresh(true);
	assert.equal(state.phase, "network_error");
	assert.equal(state.snapshot, null);
	assert.equal(state.lastSuccessAt, null);
	assert.equal(h.requests[1].init.headers["ChatGPT-Account-Id"], id);
	h.controller.dispose();
});

test("malformed JSON/data produce sanitized data errors without inventing a quota", async () => {
	for (const transport of [
		async () => new Response("synthetic-invalid-json-secret"),
		async () => Response.json({ rate_limit: { primary_window: { used_percent: "synthetic-data-secret" } } }),
	]) {
		const h = harness({ transport });
		const state = await h.controller.refresh();
		assert.equal(state.phase, "data_error");
		assert.equal(state.snapshot, null);
		assertSanitized(state, "synthetic-invalid-json-secret", "synthetic-data-secret");
		h.controller.dispose();
	}
});

test("the 10-second quota timeout also settles transports that ignore AbortSignal", async () => {
	const timeout = new AbortController();
	let requestedTimeout;
	const response = deferred();
	const h = harness({ transport: () => response.promise, timeoutSignal: (milliseconds) => {
		requestedTimeout = milliseconds;
		return timeout.signal;
	} });
	const pending = h.controller.refresh();
	await tick();
	assert.equal(requestedTimeout, TIMEOUT_MS);
	timeout.abort(new DOMException("Synthetic timeout", "TimeoutError"));
	const state = await pending;
	assert.equal(state.phase, "timeout");
	assert.equal(h.requests[0].init.signal.aborted, true);
	response.resolve(Response.json(payload()));
	await tick();
	assert.equal(h.controller.getState().phase, "timeout");
	h.controller.dispose();
});

test("shutdown settles the wait and ignores late host authentication without fetching", async () => {
	const auth = deferred();
	const h = harness({ auth: () => auth.promise });
	const pending = h.controller.refresh();
	await tick();
	const notifications = h.changes.length;
	h.controller.dispose();
	h.controller.dispose();
	await pending;
	auth.resolve(oauth());
	await tick();
	assert.equal(h.requests.length, 0);
	assert.equal(h.changes.length, notifications);
	assert.equal(h.controller.getState().snapshot, null);
	await h.controller.refresh(true);
	assert.equal(h.authCalls, 1);
});

test("shutdown aborts HTTP requests and prevents a late response from updating UI", async () => {
	const response = deferred();
	const h = harness({ transport: () => response.promise });
	const pending = h.controller.refresh();
	await tick();
	assert.equal(h.requests.length, 1);
	const notifications = h.changes.length;
	h.controller.dispose();
	assert.equal(h.requests[0].init.signal.aborted, true);
	await pending;
	response.resolve(Response.json(payload()));
	await tick();
	assert.equal(h.changes.length, notifications);
	assert.equal(h.controller.getState().snapshot, null);
});

test("restricted and nearly exhausted quotas are not colored as healthy", () => {
	const data = payload();
	data.rate_limit.allowed = false;
	assert.equal(statusLine(ready(parseQuota(data, NOW)), NOW).color, "error");
	data.rate_limit.allowed = true;
	data.rate_limit.primary_window.used_percent = 95;
	assert.equal(statusLine(ready(parseQuota(data, NOW)), NOW).color, "warning");
	data.rate_limit.primary_window.used_percent = 100;
	assert.equal(statusLine(ready(parseQuota(data, NOW)), NOW).color, "error");
});

test("public state snapshots cannot mutate the controller's cached values", async () => {
	const h = harness();
	const state = await h.controller.refresh();
	state.snapshot.windows[0].remainingPercent = 1;
	state.resetCredits.snapshot.credits[0].status = "used";
	assert.equal(h.controller.getState().snapshot.windows[0].remainingPercent, 78);
	assert.equal(h.controller.getState().resetCredits.snapshot.credits[0].status, "available");
	h.controller.dispose();
});
