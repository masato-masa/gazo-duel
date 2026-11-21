// 「判断に意味があるか」の測定。ふつうの CPU（強いカードから出し、勝てる相手を狙う）と、でたらめに動く CPU を戦わせる。
//   npx tsx scripts/sim-skill.mts [試合数]
// ふつうの CPU の勝率が 50% に近いと、カードの使いどころを選んでも結果が変わらない（運ゲー）。
import { cpuAct } from '../src/game/ai.ts';
import { randomCard } from '../src/game/cardgen.ts';
import { answerPrompt, attack, canAttack, canSetTrap, canSummon, endTurn, newGame, setTrap, summon } from '../src/game/engine.ts';
import { fieldCards, foe, pick, rand } from '../src/game/ops.ts';
import { SLOTS, TRAP_SLOTS, type P, type State } from '../src/game/types.ts';

/** でたらめ: 出す・伏せる・攻撃は全部ランダム（出せるときに出す、攻撃できるときに攻撃するが、選び方は無作為） */
function randomAct(s: State, me: P): boolean {
  if (s.winner !== null) return false;
  if (s.prompts.length) {
    const pr = s.prompts[0];
    if (pr.owner !== me) return false;
    answerPrompt(s, Math.floor(rand(s) * pr.choices.length));
    return true;
  }
  if (s.turn !== me) return false;
  if (canSetTrap(s)) {
    const ti = s.hand[me].findIndex((c) => c.kind === 'trap');
    const free = s.traps[me].findIndex((c) => !c);
    if (ti >= 0 && free >= 0 && free < TRAP_SLOTS && rand(s) < 0.5) {
      setTrap(s, ti, free);
      return true;
    }
  }
  if (canSummon(s)) {
    const ms = s.hand[me].map((c, i) => ({ c, i })).filter((x) => x.c.kind === 'monster');
    const frees = s.field[me].map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    if (ms.length && frees.length) {
      summon(s, pick(s, ms)!.i, pick(s, frees)!);
      return true;
    }
  }
  for (let slot = 0; slot < SLOTS; slot++) {
    if (!canAttack(s, slot)) continue;
    const foes = fieldCards(s, foe(me));
    if (!foes.length) {
      attack(s, slot, 'direct');
      return true;
    }
    if (rand(s) < 0.7) {
      attack(s, slot, pick(s, foes)!.slot);
      return true;
    }
  }
  endTurn(s);
  return true;
}

const N = Number(process.argv[2] ?? 600);
let smartWins = 0;
let done = 0;
for (let g = 0; g < N; g++) {
  const mk = (k: number) => ({ name: `P${k}`, cards: Array.from({ length: 10 }, (_, i) => randomCard(g * 100 + k * 10 + i, `c${i}`)) });
  const smartSeat: P = g % 2 === 0 ? 0 : 1;
  const s = newGame([mk(0), mk(1)] as never, g + 1);
  let guard = 0;
  while (s.winner === null && guard++ < 8000) {
    const acted = smartSeat === 0 ? cpuAct(s, 0) || randomAct(s, 1) : randomAct(s, 0) || cpuAct(s, 1);
    if (!acted) break;
  }
  if (s.winner === null || s.winner === 'draw') continue;
  done++;
  if (s.winner === smartSeat) smartWins++;
}
console.log(`試合 ${N}（決着 ${done}）  ふつうの CPU の勝率 ${((smartWins / done) * 100).toFixed(1)}%（50% なら判断に意味が無い）`);
