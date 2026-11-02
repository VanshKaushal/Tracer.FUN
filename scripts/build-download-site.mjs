import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const filename = "Trace-Windows-x64-Setup.exe";
const expected =
  "1f8413ce9e78b4ae6b795c93e3447efdddb10eefee93fb35c099612538df08f8";
const output = resolve(root, "dist/cloudflare-pages");
const candidates = process.argv[2]
  ? [resolve(process.argv[2])]
  : [
      resolve(root, "dist/free-beta/verified", filename),
      resolve(root, ".launch-site/dist/downloads", filename),
    ];
const local = candidates.find(existsSync);
let installer;
if (local) {
  installer = readFileSync(local);
} else {
  const response = await fetch(
    `https://gettrace.pages.dev/downloads/${filename}`,
    { signal: AbortSignal.timeout(60000) },
  );
  if (!response.ok)
    throw new Error(`Installer download failed: HTTP ${response.status}`);
  installer = Buffer.from(await response.arrayBuffer());
}
const actual = createHash("sha256").update(installer).digest("hex");
if (actual !== expected)
  throw new Error(
    "Installer checksum mismatch; refusing to package the website",
  );
mkdirSync(resolve(output, "downloads"), { recursive: true });
for (const file of [
  "index.html",
  "404.html",
  "style.css",
  "site.js",
  "trace.svg",
  "_headers",
  "robots.txt",
  "sitemap.xml",
]) {
  cpSync(resolve(root, "website", file), resolve(output, file));
}
writeFileSync(resolve(output, "downloads", filename), installer);
writeFileSync(
  resolve(output, "downloads/SHA256SUMS.txt"),
  `${actual}  ${filename}\n`,
);
console.log(
  `Cloudflare Pages assets prepared at ${output}; verified installer: ${installer.length} bytes`,
);
