// お試し・ランダムのカードを N 枚書き出して、名前の不自然さ・条件の偏り・罠の偏りを数える。
//   npx tsx scripts/dump-cards.mts [枚数=400] [--list]
import { cardEffectText, randomCard } from '../src/game/cardgen.ts';

const N = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 400);
const list = process.argv.includes('--list');
const cards = Array.from({ length: N }, (_, i) => randomCard(i * 7 + 3, `d${i}`));

// 名前の不自然さ（ヒューリスティック）
const noPairs = (n: string) => (n.match(/の/g) ?? []).length;
const problems: Record<string, (c: (typeof cards)[number]) => boolean> = {
  'の が 2 回以上（の の連鎖）': (c) => noPairs(c.name) >= 2,
  '同じ言葉が重複': (c) => new Set(c.words).size < c.words.length,
  '名前が 12 文字超': (c) => c.name.length > 12,
  '名前が 15 文字超': (c) => c.name.length > 15,
};
// 能力文の読みづらさ（ヒューリスティック）
const texts: Record<string, (t: string) => boolean> = {
  '括弧が入れ子': (t) => /（[^）]*（/.test(t),
  '「+1枚」「+1口」の言い回し': (t) => /\+1[枚口]/.test(t),
  'LP の前後に空白が無い': (t) => /[のに]LP|LPを/.test(t),
};
const textCount: Record<string, number> = {};
for (const [k, f] of Object.entries(texts)) textCount[k] = cards.filter((c) => f(cardEffectText(c))).length;
const bad = new Set<string>();
const probCount: Record<string, number> = {};
for (const [k, f] of Object.entries(problems)) probCount[k] = cards.filter(f).length;
cards.forEach((c) => { if (noPairs(c.name) >= 2 || new Set(c.words).size < 3) bad.add(c.id); });

const cnt = (xs: string[]) => {
  const m: Record<string, number> = {};
  xs.forEach((x) => (m[x] = (m[x] ?? 0) + 1));
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}(${((v / xs.length) * 100).toFixed(0)}%)`).join(' / ');
};
const mons = cards.filter((c) => c.kind === 'monster');
const traps = cards.filter((c) => c.kind === 'trap');
console.log(`カード ${N}（モンスター ${mons.length}・罠 ${traps.length}）`);
console.log('名前の問題:', Object.entries(probCount).map(([k, v]) => `${k} ${v}(${((v / N) * 100).toFixed(1)}%)`).join(' | '));
console.log('能力文の問題:', Object.entries(textCount).map(([k, v]) => `${k} ${v}(${((v / N) * 100).toFixed(1)}%)`).join(' | '));
console.log('名前の平均文字数', (cards.reduce((a, c) => a + c.name.length, 0) / N).toFixed(1));
console.log('モンスター条件:', cnt(mons.map((c) => c.ability!.cond)));
console.log('罠おまけ条件:', cnt(traps.map((c) => c.ability?.cond ?? 'おまけなし')));
console.log('全体の条件:', cnt(cards.filter((c) => c.ability).map((c) => c.ability!.cond)));
console.log('モンスター動作:', cnt(mons.map((c) => c.ability!.action)));
console.log('罠きっかけ:', cnt(traps.map((c) => c.trap!.trigger)));
console.log('罠効果:', cnt(traps.map((c) => c.trap!.core)));
console.log('罠おまけ動作:', cnt(traps.map((c) => c.ability?.action ?? 'なし')));
if (list) for (const c of cards) console.log(`${c.kind === 'trap' ? '罠' : String(c.power).padStart(4)} ${c.name} [${c.words.join(',')}] ${cardEffectText(c).replace(/\n/g, ' ')}`);
