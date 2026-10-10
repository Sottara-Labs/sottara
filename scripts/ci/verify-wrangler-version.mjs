#!/usr/bin/env node
/**
 * Fail when the installed Wrangler packages do not match scripts/ci/tool-versions.json.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));

export function readInstalledWranglerVersion(resolveFn = require.resolve) {
  const pkgPath = resolveFn("wrangler/package.json");
  return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
}

export function assertWranglerPin({ pinned, installed, runnerBin }) {
  if (!pinned) {
    return { ok: false, message: "Missing Wrangler pin in scripts/ci/tool-versions.json" };
  }
  if (!installed) {
    return { ok: false, message: "Could not resolve installed wrangler version" };
  }
  if (pinned !== installed) {
    return {
      ok: false,
      message: `Wrangler pin ${pinned} does not match installed wrangler ${installed}`,
    };
  }
  if (runnerBin && !existsSync(runnerBin) && !existsSync(`${runnerBin}.cmd`)) {
    return { ok: false, message: `Locked Wrangler binary missing at ${runnerBin}` };
  }
  return { ok: true, message: `Wrangler ${installed} matches pin and local binary` };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const pinned = JSON.parse(
    readFileSync(join(ROOT, "scripts/ci/tool-versions.json"), "utf-8"),
  ).wrangler;
  let installed;
  try {
    installed = readInstalledWranglerVersion();
  } catch {
    installed = null;
  }
  const runnerBin = join(ROOT, "node_modules", ".bin", "wrangler");
  const result = assertWranglerPin({ pinned, installed, runnerBin });
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
