// ChatGPT で作った元画像（assets-src/、git 管理外）を、画面で使う大きさの webp にする。
//   node scripts/build-art.mjs   （sharp は animal-puzzle か city-builders の node_modules を借りる）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../city-builders/node_modules/sharp');

await sharp('assets-src/trap-back.png').resize({ width: 360 }).webp({ quality: 82 }).toFile('src/assets/trap-back.webp');
await sharp('assets-src/table.png').resize({ width: 720 }).webp({ quality: 78 }).toFile('src/assets/table.webp');
console.log('done');
