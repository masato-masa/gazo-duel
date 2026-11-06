import { abilityText, fire } from './abilities';
import { damage, destroyAt, draw, emit, fieldCards, foe, heal, hooks, log, setLp, snap } from './ops';
import type { Card, P, State, TrapCore, TrapTrigger } from './types';

export const TRIGGER_TEXT: Record<TrapTrigger, string> = {
  attack: '相手がモンスターで攻撃したとき',
  direct: '相手が直接攻撃したとき',
  summon: '相手がモンスターを出したとき',
  hurt: '自分がダメージを受けたとき',
  low: '自分の LP が 1500 以下になったとき',
};

export const CORE_TEXT: Record<TrapCore, string> = {
  negateAttack: '攻撃を無効にする',
  destroyAttacker: '攻撃してきたカードを破壊して、攻撃を無効にする',
  reflectAttacker: '攻撃を無効にして、攻撃してきたカードの戦闘力ぶん相手にダメージ',
  halveAttacker: '攻撃してきたカードの戦闘力を半分にする',
  negateSummon: '出されたカードの効果を無効にする',
  destroySummoned: '出されたカードを破壊する',
  healHalf: '受けたダメージの半分を回復する',
  mirrorDamage: '受けたダメージと同じ数を相手にも与える',
  healFull: 'LP を 2000 まで回復する',
  wipeFoe: '相手の場のカードをすべて破壊する',
  draw3: 'カードを 3 枚引く',
};

/** きっかけごとに選べる効果 */
export const CORES_FOR: Record<TrapTrigger, TrapCore[]> = {
  attack: ['negateAttack', 'destroyAttacker', 'reflectAttacker', 'halveAttacker'],
  direct: ['negateAttack', 'reflectAttacker', 'halveAttacker'],
  summon: ['negateSummon', 'destroySummoned'],
  hurt: ['healHalf', 'mirrorDamage'],
  low: ['healFull', 'wipeFoe', 'draw3'],
};

export function trapText(c: Card): string {
  const t = c.trap!;
  const bonus = c.ability ? `
さらに：${abilityText(c.ability)}` : '';
  return `【罠】${TRIGGER_TEXT[t.trigger]}、${CORE_TEXT[t.core]}${bonus}`;
}

export interface TrapInfo {
  /** 攻撃・召喚をした側と場の位置 */
  actor?: P;
  slot?: number;
  damage?: number;
}

/** defender の罠を 1 枚だけ探して発動する。攻撃や召喚を止めたなら negated */
export function fireTrap(s: State, defender: P, trigger: TrapTrigger, info: TrapInfo = {}): { negated: boolean } {
  if (s.inTrap || s.winner !== null) return { negated: false };
  const idx = s.traps[defender].findIndex((c) => c?.trap?.trigger === trigger);
  if (idx < 0) return { negated: false };
  const card = s.traps[defender][idx]!;
  const { core } = card.trap!;
  s.traps[defender][idx] = null;
  s.inTrap = true;
  const text = `${CORE_TEXT[core]}`;
  log(s, `罠発動！「${card.name}」：${text}`);
  emit(s, { t: 'trap', p: defender, slot: idx, card: snap(card), text });
  let negated = false;
  const attacker = info.actor !== undefined && info.slot !== undefined ? s.field[info.actor][info.slot] : null;
  switch (core) {
    case 'negateAttack':
    case 'negateSummon':
      negated = true;
      break;
    case 'destroyAttacker':
    case 'destroySummoned':
      if (info.actor !== undefined && info.slot !== undefined) destroyAt(s, info.actor, info.slot);
      negated = true;
      break;
    case 'reflectAttacker':
      if (attacker && info.actor !== undefined) damage(s, info.actor, attacker.power);
      negated = true;
      break;
    case 'halveAttacker':
      if (attacker) attacker.power = Math.floor(attacker.power / 2);
      break;
    case 'healHalf':
      heal(s, defender, Math.floor((info.damage ?? 0) / 2));
      break;
    case 'mirrorDamage':
      damage(s, foe(defender), info.damage ?? 0);
      break;
    case 'healFull':
      if (s.lp[defender] < 2000) setLp(s, defender, 2000);
      break;
    case 'wipeFoe':
      fieldCards(s, foe(defender)).forEach((x) => destroyAt(s, foe(defender), x.slot));
      break;
    case 'draw3':
      draw(s, defender, 3);
      break;
  }
  s.grave[defender].push(card);
  if (card.ability && s.winner === null) fire(s, defender, card, card.ability);
  s.inTrap = false;
  return { negated };
}

hooks.afterDamage = (s, p, n) => {
  if (s.inTrap || s.winner !== null) return;
  if (s.lp[p] <= 1500) {
    const before = s.traps[p].filter(Boolean).length;
    fireTrap(s, p, 'low', { damage: n });
    if (s.traps[p].filter(Boolean).length < before) return;
  }
  if (n > 0) fireTrap(s, p, 'hurt', { damage: n });
};
