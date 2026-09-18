import { build } from "vite";
import { cp, mkdir, copyFile } from "node:fs/promises";
await mkdir("public", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdf.worker.min.mjs",
);
await build();
for (const file of [
  "index.html",
  "portal.html",
  "portal-v2.html",
  "apply-board.html",
  "robots.txt",
  "sitemap.xml",
])
  await copyFile(file, "dist/" + file);
for (const folder of ["docs", "extension"])
  await cp(folder, "dist/" + folder, { recursive: true });
console.log(
  "ApplyDesk built. Existing portal, docs and extension preserved; business documents and server secrets excluded.",
);
