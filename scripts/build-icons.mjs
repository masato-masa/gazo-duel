// ホーム画面に追加するアイコン。夜の紫の地に、ChatGPT 製の金の飾り枠（src/assets/card-frame.png）と「ガ」の文字。
//   node scripts/build-icons.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const text = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><text x="50%" y="62%" font-family="Yu Gothic UI, Meiryo, sans-serif" font-size="${Math.round(size * 0.42)}" font-weight="800" fill="#ffd86b" text-anchor="middle">ガ</text></svg>`);
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png'], [64, 'favicon.png']]) {
  const fw = Math.round(size * 0.56);
  const fh = Math.round(fw * 1.5);
  const frame = await sharp('src/assets/card-frame.png').resize(fw, fh, { fit: 'fill' }).toBuffer();
  const card = await sharp({ create: { width: fw, height: fh, channels: 4, background: '#2a1d4a' } }).composite([{ input: frame }]).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#1b1230' } })
    .composite([{ input: card, gravity: 'center' }, { input: text(size) }])
    .png({ compressionLevel: 9 })
    .toFile(`public/${name}`);
}
console.log('icons done');
