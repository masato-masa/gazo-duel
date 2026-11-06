import { answerPrompt, attack, canAttack, canSummon, endTurn, summon } from './engine';
import { fieldCards, foe, pick, rand } from './ops';
import type { P, State } from './types';
import { SLOTS } from './types';

/** CPU の 1 手。何かをしたら true。何もすることが無くターンを終えたときも true */
export function cpuAct(s: State, cpu: P): boolean {
  if (s.winner !== null) return false;
  // 問いは、CPU が出したものなら自分で答える（じゃんけんなどはランダム）
  if (s.prompts.length) {
    const pr = s.prompts[0];
    if (pr.owner !== cpu) return false;
    answerPrompt(s, Math.floor(rand(s) * pr.choices.length));
    return true;
  }
  if (s.turn !== cpu) return false;

  if (canSummon(s) && s.hand[cpu].length) {
    const free = s.field[cpu].findIndex((c) => !c);
    // 戦闘力の高いカードから出す。場が埋まっていたら一番弱い所に置き換える
    const hi = s.hand[cpu].reduce((b, c, i, a) => (c.base > a[b].base ? i : b), 0);
    const slot = free >= 0 ? free : s.field[cpu].reduce((b, c, i, a) => ((c?.power ?? 0) < (a[b]?.power ?? 0) ? i : b), 0);
    if (free >= 0 || s.hand[cpu][hi].base > (s.field[cpu][slot]?.power ?? 0)) {
      summon(s, hi, slot);
      return true;
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
