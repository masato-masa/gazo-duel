import { answer, fire } from './abilities';
import { checkWin, damage, destroyAt, draw, emit, fieldCards, foe, heal, log, rand } from './ops';
import { fireTrap } from './traps';
import { SLOTS, START_HAND, START_LP, TRAP_SLOTS, type Card, type P, type State } from './types';

export interface DeckInput {
  name: string;
  cards: Card[];
}

function shuffle<T>(s: State, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(decks: [DeckInput, DeckInput], seed: number): State {
  const s: State = {
    names: [decks[0].name, decks[1].name],
    lp: [START_LP, START_LP],
    deck: [[], []],
    hand: [[], []],
    field: [Array(SLOTS).fill(null), Array(SLOTS).fill(null)],
    traps: [Array(TRAP_SLOTS).fill(null), Array(TRAP_SLOTS).fill(null)],
    grave: [[], []],
    turn: 0,
    turnNo: 0,
    summonsLeft: 0,
    summonCount: 0,
    trapSetsLeft: 0,
    attacked: [],
    sealed: [],
    immortal: [],
    skipDraw: [false, false],
    poison: [{ n: 0, t: 0 }, { n: 0, t: 0 }],
    regen: [{ n: 0, t: 0 }, { n: 0, t: 0 }],
    drinks: [0, 0],
    log: [],
    prompts: [],
    events: [],
    eventSeq: 0,
    inTrap: false,
    winner: null,
    seed,
  };
  for (const p of [0, 1] as P[]) {
    // カードは対戦ごとに複製する（戦闘力が変わるため）。id は席ごとに振り直す
    const cards = decks[p].cards.map((c, i) => ({
      ...c,
      id: `${p}-${i}`,
      power: c.base,
      ability: c.ability ? { ...c.ability } : null,
      trap: c.trap ? { ...c.trap } : null,
    }));
    s.deck[p] = shuffle(s, cards);
    draw(s, p, START_HAND);
  }
  log(s, '対戦開始！');
  startTurn(s);
  return s;
}

function startTurn(s: State): void {
  s.turnNo += 1;
  s.summonsLeft = 1;
  s.summonCount = 0;
  s.trapSetsLeft = 1;
  s.attacked = [];
  const p = s.turn;
  log(s, `--- ${s.names[p]} のターン ---`);
  const po = s.poison[p];
  if (po.t > 0) {
    po.t -= 1;
    damage(s, p, po.n);
  }
  const rg = s.regen[p];
  if (rg.t > 0) {
    rg.t -= 1;
    heal(s, p, rg.n);
  }
  if (s.winner !== null) return;
  if (s.turnNo === 1) return; // 先攻の最初のターンは引かない
  if (s.skipDraw[p]) {
    s.skipDraw[p] = false;
    log(s, `${s.names[p]} はカードを引けない`);
    return;
  }
  draw(s, p, 1);
}

const blocked = (s: State): boolean => s.winner !== null || s.prompts.length > 0;

export function canSummon(s: State): boolean {
  return !blocked(s) && s.summonsLeft > 0 && s.summonCount < 4;
}

export function canSetTrap(s: State): boolean {
  return !blocked(s) && s.trapSetsLeft > 0;
}

/** 手札の handIdx 番目のモンスターを場の slot に出す。埋まっていれば置き換えて、古い方は墓地へ */
export function summon(s: State, handIdx: number, slot: number): boolean {
  if (!canSummon(s)) return false;
  const p = s.turn;
  const card = s.hand[p][handIdx];
  if (!card || card.kind !== 'monster' || slot < 0 || slot >= SLOTS) return false;
  if (s.field[p][slot]) destroyAt(s, p, slot);
  if (s.field[p][slot]) return false; // 不死身で残っていたら置けない
  s.hand[p].splice(handIdx, 1);
  s.field[p][slot] = card;
  s.summonsLeft -= 1;
  s.summonCount += 1;
  log(s, `${s.names[p]} は「${card.name}」（戦闘力 ${card.power}）を出した`);
  emit(s, { t: 'summon', p, slot });
  const r = fireTrap(s, foe(p), 'summon', { actor: p, slot });
  if (r.negated) {
    log(s, `「${card.name}」の効果は無効になった`);
    return true;
  }
  if (s.winner === null && card.ability && s.field[p][slot] === card) fire(s, p, card, card.ability);
  return true;
}

/** 罠カードを伏せる。相手には中身が見えない */
export function setTrap(s: State, handIdx: number, slot: number): boolean {
  if (!canSetTrap(s)) return false;
  const p = s.turn;
  const card = s.hand[p][handIdx];
  if (!card || card.kind !== 'trap' || slot < 0 || slot >= TRAP_SLOTS) return false;
  const old = s.traps[p][slot];
  if (old) s.grave[p].push(old);
  s.hand[p].splice(handIdx, 1);
  s.traps[p][slot] = card;
  s.trapSetsLeft -= 1;
  log(s, `${s.names[p]} はカードを 1 枚伏せた`);
  emit(s, { t: 'trapSet', p, slot });
  return true;
}

export function canAttack(s: State, slot: number): boolean {
  if (blocked(s) || s.turnNo === 1) return false;
  const c = s.field[s.turn][slot];
  return !!c && !s.attacked.includes(c.id) && !s.sealed.includes(c.id);
}

/** target: 相手の場の番号。相手の場が空なら 'direct' */
export function attack(s: State, slot: number, target: number | 'direct'): boolean {
  if (!canAttack(s, slot)) return false;
  const me = s.turn;
  const you = foe(me);
  const a = s.field[me][slot]!;
  if (target === 'direct' ? fieldCards(s, you).length > 0 : !s.field[you][target]) return false;
  s.attacked.push(a.id);
  emit(s, { t: 'attack', p: me, slot, target });

  const trap = fireTrap(s, you, target === 'direct' ? 'direct' : 'attack', { actor: me, slot });
  if (s.winner !== null) return true;
  if (trap.negated || s.field[me][slot] !== a) {
    log(s, '攻撃は無効になった');
    return true;
  }
  if (target === 'direct') {
    log(s, `「${a.name}」の直接攻撃！`);
    damage(s, you, a.power);
    return true;
  }
  const d = s.field[you][target];
  if (!d) return true;
  log(s, `「${a.name}」(${a.power}) が「${d.name}」(${d.power}) を攻撃`);
  if (a.power > d.power) {
    destroyAt(s, you, target);
    damage(s, you, a.power - d.power);
  } else if (a.power < d.power) {
    destroyAt(s, me, slot);
    damage(s, me, d.power - a.power);
  } else {
    destroyAt(s, you, target);
    destroyAt(s, me, slot);
  }
  return true;
}

export function endTurn(s: State): void {
  if (blocked(s)) return;
  // 封じは、封じられた側のターンが終わったら解ける
  const mine = new Set(s.field[s.turn].flatMap((c) => (c ? [c.id] : [])));
  s.sealed = s.sealed.filter((id) => !mine.has(id));
  s.turn = foe(s.turn);
  startTurn(s);
}

/** 画面に出ている最初の問いに答える */
export function answerPrompt(s: State, choiceIdx: number): void {
  const pr = s.prompts[0];
  if (!pr) return;
  const ch = pr.choices[choiceIdx];
  if (!ch) return;
  s.prompts.shift();
  if (pr.pending) answer(s, pr.owner, pr.pending, ch);
  else if (ch.drinks > 0) log(s, '…');
  checkWin(s);
}
