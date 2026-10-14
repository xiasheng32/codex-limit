// Explicit deployment only: build a self-contained copy from the current source.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(process.argv[2] ?? `${homedir()}/.pi/agent/extensions/codex-limit.ts`);
const source = (await Promise.all(["src/quota.ts", "src/fast-mode.ts"].map((path) => readFile(resolve(root, path), "utf8")))).join("\n");
const entry = await readFile(resolve(root, "extensions/index.ts"), "utf8");
const entryBody = entry.replace(/^import .* from "\.\.\/src\/(?:quota|fast-mode)\.ts";\n/gm, "");
const splitAt = entryBody.indexOf('const STATUS_KEY = "codex-limit";');
if (splitAt < 0 || entryBody.includes('from "../src/')) throw new Error("Unexpected extension layout; refusing to deploy");
const bundle = "// Self-contained pi autoload extension. Generated from CLIProjects/codex-limit by npm run sync-autoload.\n"
	+ entryBody.slice(0, splitAt) + source + "\n" + entryBody.slice(splitAt);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bundle);
console.log(`Updated ${target}`);
console.log("Run /reload in pi to load the updated extension.");
