// 新しい動作（乾杯・ギャンブル・場の入れ替え）の偏りの測定。デッキの 2 割のモンスターを新動作に差し替えて CPU 同士で戦わせ、
// 「使われた%」と「使われた試合の勝率」を、既存の動作（まとめて）と比べる。50% が基準。
//   npx tsx scripts/sim-new.mts [試合数] [--second]   （--second: 2 組目の 3 種）
import { cpuAct } from '../src/game/ai.ts';
import { randomCard } from '../src/game/cardgen.ts';
import { abilityText } from '../src/game/abilities.ts';
import { newGame } from '../src/game/engine.ts';
import type { Card } from '../src/game/types.ts';

const N = Number(process.argv[2] ?? 1000);
const NEW = (process.argv.includes('--second') ? ['bargain', 'russian', 'unify'] : ['kanpai', 'gamble', 'swapField']) as readonly string[];
const rows = new Map<string, { inDeck: number; played: number; win: number; drinks: number }>();
const bump = (k: string, played: boolean, win: boolean): void => {
  const r = rows.get(k) ?? { inDeck: 0, played: 0, win: 0, drinks: 0 };
  r.inDeck++;
  if (played) {
    r.played++;
    if (win) r.win++;
  }
  rows.set(k, r);
};
let done = 0;
const turns: number[] = [];
let first = 0;
for (let g = 0; g < N; g++) {
  const mk = (k: number) => ({
    name: `P${k}`,
    cards: Array.from({ length: 10 }, (_, i) => {
      const c = randomCard(g * 100 + k * 10 + i, `c${i}`);
      if (c.kind === 'monster' && ((g * 31 + k * 7 + i * 13) % 10) < 2) {
        const action = NEW[(g + k + i) % 3]!;
        const n = action === 'kanpai' || action === 'russian' ? 1 + ((g + i) % 2) : action === 'bargain' ? 1 + ((g + i) % 3) : action === 'gamble' ? [300, 500, 700, 900][(g + i) % 4]! : 0;
        c.ability = { action, n, flip: false, scale: 'flat', per: 0, cond: 'none', condN: 0 };
      }
      return c;
    }),
  });
  const decks = [mk(0), mk(1)];
  const s = newGame(decks as never, g + 1);
  let guard = 0;
  while (s.winner === null && guard++ < 8000) if (!(cpuAct(s, 0) || cpuAct(s, 1))) break;
  if (s.winner === null || s.winner === 'draw') continue;
  done++;
  turns.push(s.turnNo);
  if (s.winner === 0) first++;
  for (const p of [0, 1] as const) {
    const used = new Set<string>();
    for (const c of [...s.field[p], ...s.traps[p], ...s.grave[p]]) if (c) used.add(c.id);
    for (const [i, c] of (decks[p].cards as Card[]).entries()) {
      if (c.kind !== 'monster') continue;
      const a = c.ability?.action ?? '(なし)';
      bump(NEW.includes(a) ? a : '既存の動作（まとめて）', used.has(`${p}-${i}`), s.winner === p);
    }
  }
}
turns.sort((a, b) => a - b);
console.log(`試合 ${N}（決着 ${done}）ターン 中央値 ${turns[Math.floor(done / 2)]}・90% ${turns[Math.floor(done * 0.9)]}・最長 ${turns[done - 1]}  P0 勝率 ${((first / done) * 100).toFixed(1)}%`);
for (const [k, r] of rows) console.log(`  ${k.padEnd(20)} ${String(r.inDeck).padStart(6)} 枚  使われた ${((r.played / r.inDeck) * 100).toFixed(0)}%  使われた試合の勝率 ${((r.win / Math.max(1, r.played)) * 100).toFixed(1)}%`);
void abilityText;
