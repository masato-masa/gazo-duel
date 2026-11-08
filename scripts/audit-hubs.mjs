// 辞書の「ハブ語」（どんな入力でも最近傍になりがちな語）を測る監査ツール。
//   node scripts/audit-hubs.mjs [words.json]
// 1) ランダムなガウスベクトル 3000 本  2) 写真の説明文 60 本（画像の代わり。CLIP のテキスト側）
import { readFileSync } from 'node:fs';
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';

const data = JSON.parse(readFileSync(process.argv[2] ?? 'src/data/words.json', 'utf8'));
const { words, dim } = data;
const raw = Buffer.from(data.vecs, 'base64');
const V = new Int8Array(raw.buffer, raw.byteOffset, raw.length);
const N = words.length;

function top3(q) {
  const best = [];
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += V[i * dim + d] * q[d];
    best.push([s, i]);
  }
  best.sort((a, b) => b[0] - a[0]);
  return best.slice(0, 3).map((x) => x[1]);
}
function report(label, qs) {
  const c1 = new Map(), c3 = new Map();
  for (const q of qs) {
    const t = top3(q);
    c1.set(t[0], (c1.get(t[0]) ?? 0) + 1);
    t.forEach((i) => c3.set(i, (c3.get(i) ?? 0) + 1));
  }
  const sorted = [...c3.entries()].sort((a, b) => b[1] - a[1]);
  const share = (sorted[0][1] / (qs.length * 3)) * 100;
  const top5 = sorted.slice(0, 5).map(([i, n]) => `${words[i].en}(${((n / qs.length) * 100).toFixed(1)}%)`).join(' ');
  console.log(`${label}: 本数 ${qs.length} / 1位に出た語 ${c1.size} / 上位3に出た語 ${c3.size} (${((c3.size / N) * 100).toFixed(0)}%) / 最頻語の出現率(1本あたり) ${((sorted[0][1] / qs.length) * 100).toFixed(1)}%`);
  console.log(`  ハブ上位: ${top5}`);
}
function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
console.log(`語数 ${N}`);
report('ランダム', Array.from({ length: 3000 }, () => Float32Array.from({ length: dim }, gauss)));

const PHRASES = [
  'friends drinking beer at an izakaya', 'a plate of food on a table', 'a selfie of two people', 'a dog sleeping on a sofa',
  'a city street at night', 'a beach at sunset', 'a messy desk with a laptop', 'a train station platform', 'a crowded party',
  'a child playing in a park', 'a cat on a window sill', 'a cup of coffee on a table', 'a mountain landscape with snow',
  'a car parked on the road', 'a bowl of ramen', 'a birthday cake with candles', 'a person running on a track', 'a bookshelf in a room',
  'a close up of a flower', 'a bicycle leaning on a wall', 'a group photo in front of a building', 'a plate of sushi', 'a bottle of wine and glasses',
  'a screenshot of a smartphone app', 'a meme with text', 'a blurry photo of a room', 'a baby laughing', 'an old man walking',
  'a baseball game at a stadium', 'a street market with vegetables', 'a bedroom with an unmade bed', 'a kitchen with pots and pans',
  'a river flowing through a forest', 'a plane flying in the sky', 'a concert with bright lights', 'a person holding a fish', 'a row of vending machines',
  'a shrine in autumn', 'a cartoon character drawing', 'a pile of clothes', 'a toy on the floor', 'a person sleeping on a train',
  'a bus on a road', 'a dinner table with many dishes', 'a hand holding a phone', 'a sunset over the ocean', 'a pet rabbit eating',
  'a wedding ceremony', 'a classroom with students', 'a hospital hallway', 'a swimming pool', 'a gym with equipment', 'a park bench in the rain',
  'a close up of a face', 'a parking lot full of cars', 'a field of rice', 'a bar counter with bottles', 'a camping tent in the woods', 'a skyline at dusk', 'a pile of money',
];
const MODEL = 'Xenova/clip-vit-base-patch32';
const tok = await AutoTokenizer.from_pretrained(MODEL);
const model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' });
const { text_embeds } = await model(tok(PHRASES, { padding: true, truncation: true }));
const qs = PHRASES.map((_, k) => Array.from(text_embeds.data.slice(k * dim, (k + 1) * dim)));
report('説明文', qs);
