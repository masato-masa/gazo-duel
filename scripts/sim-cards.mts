// CPU 同士で N 試合して、カードの特徴ごとの「使われた割合」と「使われた試合の勝率」を出す。偏りの測定用。
//   npx tsx scripts/sim-cards.mts [試合数]
// 使われた = 試合の終わりに場・罠・墓地のどこかにある。勝率は 50% が基準（同じ強さの 2 人なので）。
import { cpuAct } from '../src/game/ai.ts';
import { randomCard } from '../src/game/cardgen.ts';
import { newGame } from '../src/game/engine.ts';
import type { Card } from '../src/game/types.ts';

const N = Number(process.argv[2] ?? 1500);
type Row = { inDeck: number; played: number; playedWin: number };
const tables: Record<string, Map<string, Row>> = {};
const bump = (table: string, key: string, played: boolean, win: boolean): void => {
  const m = (tables[table] ??= new Map());
  const r = m.get(key) ?? { inDeck: 0, played: 0, playedWin: 0 };
  r.inDeck++;
  if (played) {
    r.played++;
    if (win) r.playedWin++;
  }
  m.set(key, r);
};
const powerBin = (p: number): string => `${String(Math.floor(p / 500) * 500).padStart(4, '0')}-${Math.floor(p / 500) * 500 + 499}`;

let done = 0;
for (let g = 0; g < N; g++) {
  const mk = (k: number) => ({ name: `P${k}`, cards: Array.from({ length: 10 }, (_, i) => randomCard(g * 100 + k * 10 + i, `c${i}`)) });
  const decks = [mk(0), mk(1)];
  const s = newGame(decks as never, g + 1);
  let guard = 0;
  while (s.winner === null && guard++ < 6000) if (!(cpuAct(s, 0) || cpuAct(s, 1))) break;
  if (s.winner === null || s.winner === 'draw') continue;
  done++;
  for (const p of [0, 1] as const) {
    const used = new Set<string>();
    for (const c of [...s.field[p], ...s.traps[p], ...s.grave[p]]) if (c) used.add(c.id);
    const win = s.winner === p;
    for (const [i, c] of (decks[p].cards as Card[]).entries()) {
      const played = used.has(`${p}-${i}`);
      bump('種類', c.kind, played, win);
      if (c.kind === 'monster') bump('戦闘力', powerBin(c.base), played, win);
      bump('動作', c.ability?.action ?? '(なし)', played, win);
      bump('条件', c.ability?.cond ?? '(なし)', played, win);
      bump('倍率の出し方', c.ability?.scale ?? '(なし)', played, win);
      if (c.trap) bump('罠の効果', c.trap.core, played, win);
      if (c.trap) bump('罠のきっかけ', c.trap.trigger, played, win);
    }
  }
}
console.log(`試合 ${N}（決着 ${done}）`);
for (const [name, m] of Object.entries(tables)) {
  console.log(`\n[${name}]  特徴  枚数  使われた%  使われた試合の勝率%`);
  const rows = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, r] of rows) {
    if (r.played < 30) continue;
    console.log(`  ${k.padEnd(22)} ${String(r.inDeck).padStart(6)}  ${((r.played / r.inDeck) * 100).toFixed(0).padStart(3)}%  ${((r.playedWin / r.played) * 100).toFixed(1)}%`);
  }
}
