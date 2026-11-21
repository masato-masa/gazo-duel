// カード枠の元画像（assets-src/card-frame.png、ChatGPT で作成）を、外側と中身を透明にした src/assets/card-frame.png にする。
//   node scripts/build-frame.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

// カード枠: 外側と中身の白を、外周と中央から塗りつぶして透明にする（ChatGPT の画像は透過 PNG にならないため）。
{
  const { data, info } = await sharp('assets-src/card-frame.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const white = (i) => data[i] > 215 && data[i + 1] > 215 && data[i + 2] > 215;
  const seen = new Uint8Array(w * h);
  const stack = [0, w - 1, (h - 1) * w, h * w - 1, Math.floor(h / 2) * w + Math.floor(w / 2)];
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
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .resize({ width: 340 })
    .png({ compressionLevel: 9 })
    .toFile('src/assets/card-frame.png');
  console.log('card-frame done');
}
