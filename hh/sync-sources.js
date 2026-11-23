import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function sync(fromDir, toDir, ext) {
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir)) {
    if (name.endsWith(ext)) cpSync(join(fromDir, name), join(toDir, name));
  }
}

sync(join(root, "contracts"), join(here, "contracts"), ".sol");
sync(join(root, "test"), join(here, "test"), ".ts");
console.log("contracts and tests synced into hh/");
