import assert from "node:assert/strict";
import { test } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { stream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import type { Model } from "@earendil-works/pi-ai";
import { FastModeController } from "../src/fast-mode.ts";

const transportModel: Model<"openai-codex-responses"> = {
	id: "gpt-6.1-sol", name: "Synthetic Codex", provider: "openai-codex", api: "openai-codex-responses",
	baseUrl: "https://codex-test.invalid/backend-api", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
};
const syntheticToken = "synthetic." + Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: "synthetic-transport-account" },
})).toString("base64url") + ".synthetic";
const transportEvents = [
	{ type: "response.created", response: { id: "synthetic-transport-response", status: "in_progress" } },
	{ type: "response.completed", response: { id: "synthetic-transport-response", status: "completed", service_tier: "fast",
		usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 }, output: [] } },
];
const transportContext = normalizeContext({ systemPrompt: "Synthetic test", messages: [{ role: "user", content: "Synthetic test", timestamp: 0 }] });

// Every HTTP or WebSocket transport is replaced in memory; no account or network is accessed.
for (const transport of ["sse", "websocket"] as const) {
	test(`Pi's real ${transport} serializer keeps the Fast payload and exposes the returned tier`, async (t) => {
		const fast = new FastModeController();
		fast.setEnabled(true);
		let sent: Record<string, unknown> | undefined;
		let requests = 0;
		const fakeFetch: typeof fetch = async (_url, init) => {
			assert.equal(transport, "sse", "WebSocket test must not fall back to HTTP");
			requests++;
			const raw = new Headers(init?.headers).get("content-encoding") === "zstd"
				? zstdDecompressSync(Buffer.from(init!.body as Uint8Array)).toString("utf8") : String(init?.body);
			sent = JSON.parse(raw) as Record<string, unknown>;
			return new Response(transportEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
				headers: { "content-type": "text/event-stream" },
			});
		};
		class SyntheticSocket extends EventTarget {
			readyState = 0;
			constructor(url: string) {
				super();
				assert.equal(new URL(url).hostname, "codex-test.invalid");
				queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
			}
			send(value: string): void {
				requests++;
				sent = JSON.parse(value) as Record<string, unknown>;
				setImmediate(() => {
					for (const event of transportEvents) this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
				});
			}
			close(): void { this.readyState = 3; }
		}
		if (transport === "websocket") {
			const original = globalThis.WebSocket;
			globalThis.WebSocket = SyntheticSocket as unknown as typeof WebSocket;
			t.after(() => { globalThis.WebSocket = original; });
		}
		const result = await stream(transportModel, transportContext, {
			apiKey: syntheticToken, transport, fetch: fakeFetch, maxRetries: 0, timeoutMs: 1000,
			reasoningEffort: "high", sessionId: undefined,
			onPayload: (body, model) => fast.transform(body, model, true),
			onProviderStreamEvent: (data, model) => fast.observe({ provider: model.provider, api: model.api, model: model.id, data }),
		}).result();
		assert.equal(result.stopReason, "stop", result.errorMessage);
		assert.equal(requests, 1);
		assert.equal(sent?.service_tier, "fast");
		assert.equal(sent?.model, transportModel.id);
		assert.equal((sent?.reasoning as { effort: string }).effort, "high");
		assert.equal(fast.phase, "fast");
		if (transport === "websocket") assert.equal(sent?.type, "response.create");
	});
}
