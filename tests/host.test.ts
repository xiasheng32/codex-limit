import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piCodex from "../extensions/index.ts";
import { FastCatalog } from "../src/fast-catalog.ts";
import { FAST_ENTRY } from "../src/fast-mode.ts";

process.env.PI_OFFLINE = "1";
const syntheticToken = "synthetic." + Buffer.from(JSON.stringify({
	"https://api.openai.com/auth": { chatgpt_account_id: "synthetic-host-account" },
})).toString("base64url") + ".synthetic";

for (const transport of ["sse", "websocket"] as const) {
	test(`Pi SDK and ExtensionRunner drive ${transport} off → on → off with synthetic OAuth`, { timeout: 15_000 }, async (t) => {
		const directory = await mkdtemp(join(tmpdir(), "pi-codex-host-"));
		t.after(() => rm(directory, { recursive: true, force: true }));
		t.mock.method(FastCatalog.prototype, "read", async () => ({ kind: "supported" as const }));
		const sent: Record<string, unknown>[] = [];
		const observed: unknown[] = [];
		const reported: unknown[] = [];
		const errors: unknown[] = [];
		const responseEvents = () => [
			{ type: "response.created", response: { id: `synthetic-host-${sent.length}`, status: "in_progress" } },
			{ type: "response.completed", response: { id: `synthetic-host-${sent.length}`, status: "completed", service_tier: "default",
				usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 }, output: [] } },
		];
		t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
			assert.equal(transport, "sse", "WebSocket must not silently fall back to HTTP");
			assert.equal(new URL(String(url)).origin, "https://chatgpt.com");
			assert.ok(new URL(String(url)).pathname.endsWith("/responses"), "no auth/catalog/quota network path is permitted");
			const raw = new Headers(init?.headers).get("content-encoding") === "zstd"
				? zstdDecompressSync(Buffer.from(init!.body as Uint8Array)).toString("utf8") : String(init?.body);
			sent.push(JSON.parse(raw) as Record<string, unknown>);
			return new Response(responseEvents().map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
				headers: { "content-type": "text/event-stream" },
			});
		});
		class SyntheticSocket extends EventTarget {
			readyState = 0;
			constructor(url: string) {
				super();
				assert.equal(new URL(url).hostname, "chatgpt.com");
				queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
			}
			send(value: string): void {
				sent.push(JSON.parse(value) as Record<string, unknown>);
				setImmediate(() => { for (const event of responseEvents()) this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); });
			}
			close(): void { this.readyState = 3; }
		}
		if (transport === "websocket") {
			const original = globalThis.WebSocket;
			globalThis.WebSocket = SyntheticSocket as unknown as typeof WebSocket;
			t.after(() => { globalThis.WebSocket = original; });
		}
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("openai-codex", async () => ({ type: "oauth", access: syntheticToken,
			refresh: "synthetic-refresh", expires: Date.now() + 86400_000 }));
		const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
		const model = runtime.getModels("openai-codex").find((candidate) => candidate.api === "openai-codex-responses");
		assert.ok(model, "installed host must expose a built-in Codex subscription model");
		assert.equal(runtime.isUsingOAuth("openai-codex"), true);
		const settings = SettingsManager.inMemory({ transport, cacheWarming: "off", compaction: { enabled: false }, retry: { enabled: false } });
		const observer = (pi: ExtensionAPI) => {
			pi.on("before_provider_request", (event) => { observed.push(event.payload); });
			pi.on("provider_stream_event", (event) => { reported.push(event.data); });
		};
		const loader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager: settings,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, disabledBuiltinExtensions: ["mcp"],
			extensionFactories: [piCodex, observer] });
		await loader.reload();
		const manager = SessionManager.inMemory(directory);
		const { session, extensionsResult } = await createAgentSession({ cwd: directory, agentDir: directory, modelRuntime: runtime,
			model, thinkingLevel: "high", noTools: "all", settingsManager: settings, sessionManager: manager, resourceLoader: loader });
		t.after(() => session.dispose());
		assert.deepEqual(extensionsResult.errors, []);
		await session.bindExtensions({ mode: "rpc", onError: (error) => { errors.push(error); } });
		await session.prompt("Synthetic initial request");
		assert.equal(sent.length, 1);
		await session.prompt("/fast on");
		assert.equal(sent.length, 1, "slash command must not become a model request");
		await session.prompt("Synthetic Fast request");
		await session.prompt("/fast off");
		assert.equal(sent.length, 2, "off command must not become a model request");
		await session.prompt("Synthetic standard request");
		assert.deepEqual(sent.map((body) => body.service_tier), ["default", "priority", "default"]);
		assert.deepEqual(observed.map((body) => (body as Record<string, unknown>).service_tier), ["default", "priority", "default"]);
		assert.equal(reported.filter((event) => (event as { type: string }).type === "response.completed").length, 3);
		assert.deepEqual(manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === FAST_ENTRY)
			.map((entry) => (entry as { data: { enabled: boolean } }).data.enabled), [true, false]);
		assert.deepEqual(errors, []);
	});
}
