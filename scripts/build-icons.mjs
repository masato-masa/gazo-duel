// アイコンシート（assets-src/icons.png、ChatGPT で作成。左からビール・罠・剣）を、背景を透明にして 3 つに切り出す。
//   node scripts/build-icons.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const { data, info } = await sharp('assets-src/icons.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const white = (i) => data[i] > 222 && data[i + 1] > 222 && data[i + 2] > 222;
const seen = new Uint8Array(w * h);
const stack = [0, w - 1, (h - 1) * w, h * w - 1];
while (stack.length) {
  const p = stack.pop();
  if (seen[p] || !white(p * 4)) continue;
  seen[p] = 1;
  data[p * 4 + 3] = 0;
  const x = p % w;
  if (x > 0) stack.push(p - 1);
  if (x < w - 1) stack.push(p + 1);
  if (p >= w) stack.push(p - w);
  if (p < (h - 1) * w) stack.push(p + w);
}
// 列ごとに不透明な画素があるかを見て、3 つのかたまりに分ける
const colHas = Array.from({ length: w }, (_, x) => {
  for (let y = 0; y < h; y++) if (data[(y * w + x) * 4 + 3] > 0) return true;
  return false;
});
const spans = [];
let start = -1;
for (let x = 0; x <= w; x++) {
  if (x < w && colHas[x]) {
    if (start < 0) start = x;
  } else if (start >= 0) {
    if (x - start > 40) spans.push([start, x - 1]);
    start = -1;
  }
}
if (spans.length !== 3) throw new Error(`アイコンが 3 つに分かれない: ${spans.length}`);
const names = ['icon-beer', 'icon-trap', 'icon-sword'];
for (const [k, [x0, x1]] of spans.entries()) {
  let y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) if (data[(y * w + x) * 4 + 3] > 0) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .resize({ height: 96, width: 96, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(`src/assets/${names[k]}.png`);
}
console.log('icons done', spans);
