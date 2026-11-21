// 能力アイコンのシート（assets-src/ability-icons.png、ChatGPT で作成。3 列 2 行: 炎・ハート・上矢印・下矢印・カード・杖）を、
// 背景を透明にして 6 つに切り出す。  node scripts/build-ability-icons.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const { data, info } = await sharp('assets-src/ability-icons.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
const spans = (len, has, minGap = 30) => {
  const out = [];
  let start = -1;
  for (let i = 0; i <= len; i++) {
    if (i < len && has(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out.filter(([a, b]) => b - a > minGap);
};
const rows = spans(h, (y) => { for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 0) return true; return false; });
if (rows.length !== 2) throw new Error(`行が 2 つに分かれない: ${rows.length}`);
const names = ['fire', 'heart', 'up', 'down', 'cards', 'wand'];
let k = 0;
for (const [y0, y1] of rows) {
  const cols = spans(w, (x) => { for (let y = y0; y <= y1; y++) if (data[(y * w + x) * 4 + 3] > 0) return true; return false; });
  if (cols.length !== 3) throw new Error(`列が 3 つに分かれない: ${cols.length}`);
  for (const [x0, x1] of cols) {
    let ty0 = y1, ty1 = y0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (data[(y * w + x) * 4 + 3] > 0) { ty0 = Math.min(ty0, y); ty1 = Math.max(ty1, y); }
    await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: x0, top: ty0, width: x1 - x0 + 1, height: ty1 - ty0 + 1 })
      .resize({ height: 80, width: 80, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(`src/assets/ab-${names[k++]}.png`);
  }
}
console.log('ability icons done');
