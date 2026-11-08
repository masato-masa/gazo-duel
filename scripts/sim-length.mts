// CPU 同士で N 試合して、試合の長さ（ターン数）の分布と先手勝率を出す。辞書・戦闘力・効果の倍率を変えたら走らせる。
//   npx tsx scripts/sim-length.mts [試合数]
import { cpuAct } from '../src/game/ai.ts';
import { randomCard } from '../src/game/cardgen.ts';
import { newGame } from '../src/game/engine.ts';

const N = Number(process.argv[2] ?? 600);
const turns: number[] = [];
let first = 0;
let unfinished = 0;
for (let g = 0; g < N; g++) {
  const mk = (k: number) => ({ name: `P${k}`, cards: Array.from({ length: 10 }, (_, i) => randomCard(g * 100 + k * 10 + i, `c${i}`)) });
  const s = newGame([mk(0), mk(1)], g + 1);
  let guard = 0;
  while (s.winner === null && guard++ < 6000) if (!(cpuAct(s, 0) || cpuAct(s, 1))) break;
  if (s.winner === null) {
    unfinished++;
    continue;
  }
  turns.push(s.turnNo);
  if (s.winner === 0) first++;
}
turns.sort((a, b) => a - b);
const q = (p: number) => turns[Math.min(turns.length - 1, Math.floor(turns.length * p))];
console.log(`試合 ${N}（未決着 ${unfinished}）  ターン数: 中央値 ${q(0.5)}・平均 ${(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1)}・25% ${q(0.25)}・75% ${q(0.75)}・90% ${q(0.9)}・最長 ${turns[turns.length - 1]}`);
console.log(`P0（先攻とは限らない席）の勝率 ${((first / turns.length) * 100).toFixed(1)}%`);
