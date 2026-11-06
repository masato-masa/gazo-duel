import data from '../data/words.json';
import { CARD_PARTS, effectText } from './effects';
import type { Card, Effect } from './types';

export interface Word {
  en: string;
  noun: string;
  mod: string;
}

export const WORDS: Word[] = data.words;
const DIM = data.dim;

let vecs: Int8Array | null = null;
function wordVecs(): Int8Array {
  if (!vecs) {
    const bin = atob(data.vecs);
    const a = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = (bin.charCodeAt(i) << 24) >> 24;
    vecs = a;
  }
  return vecs;
}

/** 画像の特徴ベクトルに近い言葉の番号を、近い順に返す */
export function nearestWords(emb: ArrayLike<number>, k = 3): number[] {
  const v = wordVecs();
  const sims: { i: number; s: number }[] = [];
  for (let i = 0; i < WORDS.length; i++) {
    let dot = 0;
    for (let d = 0; d < DIM; d++) dot += v[i * DIM + d] * emb[d];
    sims.push({ i, s: dot });
  }
  sims.sort((a, b) => b.s - a.s);
  return sims.slice(0, k).map((x) => x.i);
}

/** 同じ画像からは必ず同じ数が出るように、ベクトルの符号から種を作る */
export function seedOf(emb: ArrayLike<number>): number {
  let h = 2166136261;
  for (let d = 0; d < DIM; d++) {
    h ^= emb[d] > 0 ? 1 : 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 言葉の意味から素直に決める効果。ここに無い言葉は、言葉の綴りから決まる */
const MEANING: Record<string, string> = {};
const assign = (part: string, words: string) => words.split(',').forEach((w) => (MEANING[w] = part));
assign('heal', 'apple,banana,orange fruit,strawberry,grapes,watermelon,lemon,peach,cherry,pineapple,carrot,tomato,bread,rice,sushi,salad,soup,curry,sandwich,tofu,honey,cake,egg,cheese,pill,bandage,heart,angel,milk,tea,water bottle,juice')
assign('damage', 'sword,knife,axe,spear,bow and arrow,gun,dagger,hammer,cannon,bomb,saw,needle,scissors,syringe,fire,flame,lightning,explosion,battle,war,anger,tiger,lion,wolf,shark,crocodile,dragon')
assign('seal', 'shield,armor,helmet,lock,chain,rope,door')
assign('drinkFoe', 'beer,wine,whiskey,sake,cocktail,champagne,soda,bar,party,festival,hangover,drunk')
assign('drinkAll', 'wedding,birthday,christmas,friends,family')
assign('draw', 'book,notebook,map,telescope,letter,envelope,library,school,teacher,student')
assign('selfUp', 'muscle,boxing,power,gorilla,bear,elephant,tractor,truck,king,knight,soldier')
assign('poison', 'poison,spider,snake,mushroom,rotten,smelly,cockroach')
assign('regen', 'sleepy,nap,bed,pillow,blanket,cozy,bathtub,garden,forest,tree')
assign('silence', 'silence,quiet,boredom,monday,deadline,meeting,exam,homework,overtime work')
assign('swapLp', 'mirror,chaos,weird,strange')
assign('returnSelf', 'boomerang,bicycle,ring,compass')

/** LP・戦闘力にかかる効果の大きさの倍率（CPU 同士 600 戦で、試合の長さを見て決めた） */
const EFFECT_SCALE = 0.7;

function partIndexFor(en: string): number {
  const m = MEANING[en];
  if (m) return CARD_PARTS.findIndex((p) => p.id === m);
  return hashStr(en) % CARD_PARTS.length;
}

/**
 * 近い言葉 3 つから、名前・効果・戦闘力を決める。
 * 名前は「修飾の形 → 名詞」の順（禁断の赤いリンゴ）。いちばん近い名詞を末尾に置く。
 */
export function buildCard(top: number[], seed: number, img: string, id: string): Card {
  const rnd = mulberry(seed);
  const ws = top.map((i) => WORDS[i]);
  const isAdj = (w: Word) => w.mod !== `${w.noun}の` && w.mod.length > 0;
  // 末尾の名詞: 近い順で最初の「形容でない言葉」。無ければ最も近い言葉
  const head = ws.find((w) => !isAdj(w)) ?? ws[0];
  const rest = ws.filter((w) => w !== head).reverse();
  const name = rest.map((w) => w.mod).join('') + head.noun;

  // 効果: 3 語それぞれから 1 つ。同じ部品はずらして重ねない
  const used = new Set<number>();
  const effects: Effect[] = ws.map((w) => {
    let idx = partIndexFor(w.en);
    while (used.has(idx)) idx = (idx + 1) % CARD_PARTS.length;
    used.add(idx);
    const part = CARD_PARTS[idx];
    const [min, max, step] = part.range;
    let n = min + step * Math.floor(rnd() * ((max - min) / step + 1));
    // 数値の大きい効果（LP・戦闘力）は、試合が短くなりすぎないよう控えめにする
    if (step >= 100) n = Math.max(min, Math.round((n * EFFECT_SCALE) / 100) * 100);
    return { part: part.id, n };
  });

  // 戦闘力: 0〜4800。低い方に寄せて、たまに強いカードが出る
  const u = rnd();
  const power = Math.round(u ** 1.4 * 20) * 100;

  return { id, name, power, base: power, effects, img, words: ws.map((w) => w.en) };
}

export function cardFromEmbedding(emb: ArrayLike<number>, img: string, id: string): Card {
  return buildCard(nearestWords(emb), seedOf(emb), img, id);
}

/** 画像の無い試し用のカード（お試しデッキ・CPU 用）。種から言葉を引く */
export function randomCard(seed: number, id: string): Card {
  const rnd = mulberry(seed);
  const top = [0, 0, 0].map(() => Math.floor(rnd() * WORDS.length));
  return buildCard(top, Math.floor(rnd() * 4294967296), '', id);
}

export function cardEffectText(c: Card): string {
  return c.effects.map(effectText).join('。') + '。';
}
