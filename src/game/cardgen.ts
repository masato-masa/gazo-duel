import data from '../data/words.json';
import { abilityText, ACTIONS, NONE_UNIT_CONDS } from './abilities';
import { CORES_FOR, trapText } from './traps';
import type { Ability, Card, CondKind, Scale, TrapTrigger } from './types';

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

function weighted<T>(rnd: () => number, items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r < 0) return v;
  }
  return items[items.length - 1][0];
}

/** 言葉の意味から素直に決める動作。ここに無い言葉は、言葉の綴りから決まる */
const MEANING: Record<string, string> = {};
const assign = (action: string, words: string) => words.split(',').forEach((w) => (MEANING[w] = action));
assign('heal', 'apple,banana,orange fruit,strawberry,grapes,watermelon,lemon,peach,cherry,pineapple,carrot,tomato,bread,rice,sushi,salad,soup,curry,sandwich,tofu,honey,cake,egg,cheese,pill,bandage,heart,angel,milk,tea,water bottle,juice');
assign('damage', 'sword,knife,axe,spear,bow and arrow,gun,dagger,hammer,cannon,bomb,saw,needle,scissors,syringe,fire,flame,lightning,explosion,battle,war,anger,tiger,lion,wolf,shark,crocodile,dragon');
assign('seal', 'shield,armor,helmet,lock,chain,rope,door');
assign('drinkFoe', 'beer,wine,whiskey,sake,cocktail,champagne,soda,bar,party,festival,hangover,drunk');
assign('draw', 'book,notebook,map,telescope,letter,envelope,library,school,teacher,student');
assign('powerUp', 'muscle,boxing,power,gorilla,bear,elephant,tractor,truck,king,knight,soldier');
assign('poison', 'poison,spider,snake,mushroom,rotten,smelly,cockroach');
assign('regen', 'sleepy,nap,bed,pillow,blanket,cozy,bathtub,garden,forest,tree');
assign('discard', 'silence,quiet,boredom,monday,deadline,meeting,exam,homework,overtime work');
assign('swapLp', 'mirror,chaos,weird,strange');
// 追加した言葉（2026-11-08）
assign('heal', 'pudding,yogurt,mango,melon,avocado,pumpkin,hot pot,green tea,nurse,kitten,puppy,rice ball,bento box,sweet potato,omelet');
assign('damage', 'katana,chainsaw,tank,scorpion,tsunami,earthquake,bonfire,sumo,rugby,avalanche,thief');
assign('seal', 'fence,brick wall,handcuffs,prisoner,scarecrow');
assign('drinkFoe', 'beer mug,wine glass,sake bottle,highball,izakaya,afterparty,drinking game,karaoke,vending machine,cola');
assign('draw', 'comic book,newspaper,movie,anime,detective,scientist,photograph');
assign('powerUp', 'sumo wrestler,rhinoceros,hero,samurai,cowboy,energy drink');
assign('regen', 'hot spring,cozy,bathroom,swimming pool,yoga');
assign('discard', 'late for work,all nighter,hangover morning,breakup,lie');

/** 向きが反転しやすい（自分に返る・相手が得する）言葉 */
const UNLUCKY = new Set(['embarrassment', 'regret', 'late for work', 'breakup', 'all nighter', 'hangover morning', 'monday', 'deadline', 'overtime work', 'hangover', 'boredom', 'rotten', 'cursed', 'curse', 'trap', 'clown', 'zombie', 'ghost']);

/** LP・戦闘力にかかる効果の大きさの倍率（CPU 同士の対戦で、試合の長さを見て決めた） */
const EFFECT_SCALE = 0.7;

const TRAP_BONUS = ['heal', 'damage', 'draw', 'drinkFoe', 'powerDown', 'discard'];

function rollAbility(rnd: () => number, w1: Word, w2: Word, allowed?: string[]): Ability {
  const pool = allowed ? ACTIONS.filter((a) => allowed.includes(a.id)) : ACTIONS;
  const mapped = MEANING[w1.en];
  const act = (mapped && pool.find((a) => a.id === mapped)) || pool[hashStr(w1.en) % pool.length];
  const [min, max, step] = act.range;
  let n = min + step * Math.floor(rnd() * ((max - min) / step + 1));
  if (act.unit === 'lp') n = Math.max(min, Math.round((n * EFFECT_SCALE) / 100) * 100);

  const flip = UNLUCKY.has(w2.en) || rnd() < 0.15;

  let scale: Scale = 'flat';
  let per = 0;
  if (act.unit === 'lp') {
    scale = weighted<Scale>(rnd, [['flat', 32], ['perHand', 15], ['perField', 12], ['perGrave', 8], ['perDrunk', 8], ['perTurn', 8], ['dice', 10], ['lpGap', 7]]);
    per = scale === 'perDrunk' ? 200 : 100;
  }

  const condPool: [CondKind, number][] = [
    ['none', 34], ['sake', 20], ['rps', 8], ['name', 8], ['shame', 6], ['praise', 5], ['imitate', 5], ['coin', 8], ['parity', 6],
  ];
  const conds = act.unit === 'none' ? condPool.filter(([c]) => NONE_UNIT_CONDS.includes(c)) : condPool;
  const cond = weighted(rnd, conds);
  const condN = act.unit === 'count' ? 1 : [100, 200, 300][Math.floor(rnd() * 3)];
  return { action: act.id, n: act.unit === 'none' ? 0 : n, flip, scale, per, cond, condN };
}

/**
 * 近い言葉 3 つから、カード 1 枚を決める。能力は 1 つ（動作 × 向き × 数値の出し方 × 条件）。
 * 名前は「修飾の形 → 名詞」の順（禁断の赤いリンゴ）。いちばん近い名詞を末尾に置く。
 */
export function buildCard(top: number[], seed: number, img: string, id: string): Card {
  const rnd = mulberry(seed);
  const ws = top.map((i) => WORDS[i]);
  const isAdj = (w: Word) => w.mod !== `${w.noun}の` && w.mod.length > 0;
  const head = ws.find((w) => !isAdj(w)) ?? ws[0];
  const rest = ws.filter((w) => w !== head).reverse();
  const name = rest.map((w) => w.mod).join('') + head.noun;
  const hue = Math.floor(rnd() * 360);
  const isTrap = rnd() < 0.3;
  const words = ws.map((w) => w.en);

  if (!isTrap) {
    const ability = rollAbility(rnd, ws[0], ws[1]);
    // 戦闘力: 0〜2000。低い方に寄せて、たまに強いカードが出る
    const power = Math.round(rnd() ** 1.4 * 20) * 100;
    return { id, kind: 'monster', name, power, base: power, ability, trap: null, img, words, hue };
  }
  const trigger = weighted<TrapTrigger>(rnd, [['attack', 30], ['direct', 14], ['summon', 22], ['hurt', 20], ['low', 14]]);
  const cores = CORES_FOR[trigger];
  const core = cores[hashStr(ws[0].en) % cores.length];
  const ability = rnd() < 0.85 ? rollAbility(rnd, ws[1], ws[2], TRAP_BONUS) : null;
  return { id, kind: 'trap', name, power: 0, base: 0, ability, trap: { trigger, core }, img, words, hue };
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
  if (c.kind === 'trap') return trapText(c);
  return c.ability ? `【出したとき】${abilityText(c.ability)}` : '';
}

const NOUN = new Map(WORDS.map((w) => [w.en, w.noun]));
/** 英語の言葉の日本語（名詞の形）。絵に大きく載せる */
export const nounOf = (en: string): string => NOUN.get(en) ?? en;
