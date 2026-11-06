// data/words.txt の各語を CLIP のテキスト側で数字の列（ベクトル）にして
// src/data/words.json に書き出す。ブラウザでは画像側だけ動かし、ここで作った
// ベクトルと突き合わせる（言葉 700 語ぶんを毎回計算しない）。
//   node scripts/build-embeddings.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';

const MODEL = 'Xenova/clip-vit-base-patch32';

const lines = readFileSync('data/words.txt', 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#'));

const words = lines.map((l) => {
  const [en, noun, mod] = l.split('|');
  return { en: en.trim(), noun: noun.trim(), mod: (mod ?? `${noun}の`).trim() };
});

const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' });

const dim = 512;
const bytes = new Int8Array(words.length * dim);
const BATCH = 32;
for (let i = 0; i < words.length; i += BATCH) {
  const chunk = words.slice(i, i + BATCH);
  const inputs = tokenizer(chunk.map((w) => `a photo of ${w.en}`), { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const data = text_embeds.data; // [n, 512]
  for (let k = 0; k < chunk.length; k++) {
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += data[k * dim + d] ** 2;
    norm = Math.sqrt(norm);
    for (let d = 0; d < dim; d++) bytes[(i + k) * dim + d] = Math.round((data[k * dim + d] / norm) * 127);
  }
  process.stdout.write(`\r${Math.min(i + BATCH, words.length)} / ${words.length}`);
}
console.log();

mkdirSync('src/data', { recursive: true });
writeFileSync(
  'src/data/words.json',
  JSON.stringify({ model: MODEL, dim, words, vecs: Buffer.from(bytes.buffer).toString('base64') }),
);
console.log(`書き出し: ${words.length} 語、${Math.round((bytes.length * 4) / 3 / 1024)} KB`);
