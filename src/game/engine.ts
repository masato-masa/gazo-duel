import { runEffect } from './effects';
import { checkWin, damage, destroyAt, draw, fieldCards, foe, heal, log, rand, sendToGrave } from './ops';
import { SLOTS, START_HAND, START_LP, type Card, type P, type State } from './types';

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
    grave: [[], []],
    turn: 0,
    turnNo: 0,
    summonsLeft: 0,
    summonCount: 0,
    attacked: [],
    sealed: [],
    immortal: [],
    skipDraw: [false, false],
    poison: [{ n: 0, t: 0 }, { n: 0, t: 0 }],
    regen: [{ n: 0, t: 0 }, { n: 0, t: 0 }],
    drinks: [0, 0],
    log: [],
    prompts: [],
    winner: null,
    seed,
  };
  for (const p of [0, 1] as P[]) {
    // カードは対戦ごとに複製する（戦闘力が変わるため）。id は席ごとに振り直す
    const cards = decks[p].cards.map((c, i) => ({ ...c, id: `${p}-${i}`, power: c.base, effects: c.effects.map((e) => ({ ...e })) }));
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
  s.attacked = [];
  const p = s.turn;
  // 前の相手のターンで封じられたカードは、この持ち主のターンの間だけ動けない
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

/** 手札の handIdx 番目を場の slot に出す。埋まっていれば置き換えて、古い方は墓地へ */
export function summon(s: State, handIdx: number, slot: number): boolean {
  if (!canSummon(s)) return false;
  const p = s.turn;
  const card = s.hand[p][handIdx];
  if (!card || slot < 0 || slot >= SLOTS) return false;
  const old = s.field[p][slot];
  if (old) {
    s.field[p][slot] = null;
    sendToGrave(s, p, old);
    log(s, `${old.name} は入れ替わりで墓地へ`);
  }
  s.hand[p].splice(handIdx, 1);
  s.field[p][slot] = card;
  s.summonsLeft -= 1;
  s.summonCount += 1;
  log(s, `${s.names[p]} は「${card.name}」（戦闘力 ${card.power}）を出した`);
  for (const e of card.effects) {
    if (s.winner !== null) break;
    runEffect({ s, me: p, card }, e);
  }
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
  s.attacked.push(a.id);
  if (target === 'direct') {
    if (fieldCards(s, you).length) return false;
    log(s, `「${a.name}」の直接攻撃！`);
    damage(s, you, a.power);
    return true;
  }
  const d = s.field[you][target];
  if (!d) return false;
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
  const me = ch.who === 'owner' ? pr.owner : foe(pr.owner);
  runEffect({ s, me, card: null }, ch.eff);
  checkWin(s);
}

export { fieldCards };
