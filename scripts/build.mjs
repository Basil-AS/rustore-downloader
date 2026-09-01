import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const root = new URL("../", import.meta.url);
const assets = [
  "index.html",
  "api-patch.js",
  "css",
  "js",
  "LICENSE",
  "NOTICE"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const asset of assets) {
  await cp(new URL(asset, root), new URL(asset, output), {
    recursive: true,
    force: true
  });
}

console.log("Static assets prepared in dist/");
