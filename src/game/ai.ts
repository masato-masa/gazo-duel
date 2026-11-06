import { answerPrompt, attack, canAttack, canSetTrap, canSummon, endTurn, setTrap, summon } from './engine';
import { fieldCards, foe, pick, rand } from './ops';
import type { P, State } from './types';
import { SLOTS, TRAP_SLOTS } from './types';

/** CPU の 1 手。何かをしたら true。何もすることが無くターンを終えたときも true */
export function cpuAct(s: State, cpu: P): boolean {
  if (s.winner !== null) return false;
  // 問いは、CPU が出したものなら自分で答える。お酒は CPU なので遠慮なく最大まで（強くなる）
  if (s.prompts.length) {
    const pr = s.prompts[0];
    if (pr.owner !== cpu) return false;
    const last = pr.choices.length - 1;
    answerPrompt(s, pr.choices[0].drinks === 0 && pr.choices.length === 4 ? last : Math.floor(rand(s) * pr.choices.length));
    return true;
  }
  if (s.turn !== cpu) return false;

  // 罠は空きがあればすぐ伏せる
  if (canSetTrap(s)) {
    const ti = s.hand[cpu].findIndex((c) => c.kind === 'trap');
    const free = s.traps[cpu].findIndex((c) => !c);
    if (ti >= 0 && free >= 0 && free < TRAP_SLOTS) {
      setTrap(s, ti, free);
      return true;
    }
  }

  if (canSummon(s)) {
    const monsters = s.hand[cpu].map((c, i) => ({ c, i })).filter((x) => x.c.kind === 'monster');
    if (monsters.length) {
      const hi = monsters.reduce((b, x) => (x.c.base > b.c.base ? x : b));
      const free = s.field[cpu].findIndex((c) => !c);
      const weakSlot = s.field[cpu].reduce((b, c, i, a) => ((c?.power ?? 0) < (a[b]?.power ?? 0) ? i : b), 0);
      const slot = free >= 0 ? free : weakSlot;
      if (free >= 0 || hi.c.base > (s.field[cpu][slot]?.power ?? 0)) {
        summon(s, hi.i, slot);
        return true;
      }
    }
  }

  for (let slot = 0; slot < SLOTS; slot++) {
    if (!canAttack(s, slot)) continue;
    const me = s.field[cpu][slot]!;
    const foes = fieldCards(s, foe(cpu));
    if (!foes.length) {
      attack(s, slot, 'direct');
      return true;
    }
    // 勝てる相手のうち、いちばん強い相手を狙う。勝てなければ 2 割だけ無謀に挑む
    const winnable = foes.filter((f) => f.card.power < me.power).sort((a, b) => b.card.power - a.card.power);
    const t = winnable[0] ?? (rand(s) < 0.2 ? pick(s, foes) : undefined);
    if (t) {
      attack(s, slot, t.slot);
      return true;
    }
  }
  endTurn(s);
  return true;
}
