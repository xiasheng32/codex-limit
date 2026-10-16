import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the generated standalone extension loads through the real Pi module aliases", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-codex-deployment-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	t.mock.method(globalThis, "fetch", async () => { throw new Error("Deployment checks must not access the network"); });
	const target = join(directory, "pi-codex.ts");
	const generated = spawnSync(process.execPath, [join(root, "scripts/sync-autoload.ts"), target], {
		cwd: root, env: { ...process.env, HOME: directory, USERPROFILE: directory, PI_OFFLINE: "1" },
		encoding: "utf8", timeout: 10_000,
	});
	assert.ifError(generated.error);
	assert.equal(generated.status, 0, generated.stderr);
	const loader = new DefaultResourceLoader({
		cwd: directory, agentDir: directory, settingsManager: SettingsManager.inMemory(),
		noExtensions: true, additionalExtensionPaths: [target], disabledBuiltinExtensions: ["mcp"],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await loader.reload();
	const loaded = loader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	assert.deepEqual([...loaded.extensions[0].commands.keys()].sort(), ["fast", "pi-codex"]);
});
