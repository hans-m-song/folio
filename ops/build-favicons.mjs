import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const pdfRequire = createRequire(
  require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
);
const { createCanvas, loadImage } = pdfRequire("@napi-rs/canvas");
const publicUrl = new URL("../public/", import.meta.url);
const source = await loadImage(
  await readFile(new URL("brand/folio-mark.svg", publicUrl)),
);
const smallSource = await loadImage(
  await readFile(new URL("brand/folio-favicon.svg", publicUrl)),
);
const render = (size) => {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(size === 16 ? smallSource : source, 0, 0, size, size);
  return canvas.toBuffer("image/png");
};

const entries = [];
for (const size of [16, 32, 48]) {
  const png = render(size);
  await writeFile(new URL(`favicon-${size}.png`, publicUrl), png);
  entries.push({ size, png });
}
await writeFile(new URL("brand/folio-coin-64.png", publicUrl), render(64));
await writeFile(new URL("apple-touch-icon.png", publicUrl), render(180));

const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(
  new URL("favicon.ico", publicUrl),
  Buffer.concat([header, ...entries.map(({ png }) => png)]),
);
