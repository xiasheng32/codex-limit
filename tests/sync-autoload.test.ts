import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/sync-autoload.ts");

async function expectedBundle(): Promise<string> {
	const source = (await Promise.all(["src/quota.ts", "src/fast-mode.ts", "src/fast-catalog.ts"].map((path) => readFile(join(root, path), "utf8")))).join("\n")
		.replace(/^import .* from "\.\/(?:quota|fast-mode)\.ts";\n/gm, "");
	const entry = await readFile(join(root, "extensions/index.ts"), "utf8");
	const body = entry.replace(/^import .* from "\.\.\/src\/(?:quota|fast-mode|fast-catalog)\.ts";\n/gm, "");
	const split = body.indexOf('const STATUS_KEY = "pi-codex";');
	assert.ok(split >= 0);
	return "// Self-contained pi autoload extension. Generated from CLIProjects/pi-codex by npm run sync-autoload.\n"
		+ body.slice(0, split) + source + "\n" + body.slice(split);
}

function runScript(home: string, args: string[]): string {
	const result = spawnSync(process.execPath, [script, ...args], {
		cwd: root,
		// Both explicit and default destinations are isolated from the real Pi home.
		env: { ...process.env, HOME: home, USERPROFILE: home },
		encoding: "utf8",
		timeout: 10_000,
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}

test("TS sync script generates an exact self-contained bundle at an explicit nested destination", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-sync-"));
	try {
		const target = join(home, "nested", "pi-codex.ts");
		assert.ok(runScript(home, [target]).includes(`Updated ${target}`));
		assert.equal(await readFile(target, "utf8"), await expectedBundle());
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("TS sync script defaults to the sandbox autoload path without touching the real Pi home", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-sync-"));
	try {
		const target = join(home, ".pi", "agent", "extensions", "pi-codex.ts");
		assert.ok(runScript(home, []).includes(`Updated ${target}`));
		assert.equal(await readFile(target, "utf8"), await expectedBundle());
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
