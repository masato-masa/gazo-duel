import type { Card, Choice, GameEvent, P, Prompt, Snap, State } from './types';

export function rand(s: State): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(s: State, a: T[]): T | undefined {
  return a.length ? a[Math.floor(rand(s) * a.length)] : undefined;
}

export const foe = (p: P): P => (p === 0 ? 1 : 0);

export function log(s: State, text: string): void {
  s.log.push(text);
  if (s.log.length > 300) s.log.shift();
}

type EventBody = GameEvent extends infer E ? (E extends { id: number } ? Omit<E, 'id'> : never) : never;
/** 画面の演出用の出来事を足す（ゲームの結果には影響しない） */
export function emit(s: State, e: EventBody): void {
  s.eventSeq += 1;
  s.events.push({ ...e, id: s.eventSeq } as GameEvent);
  if (s.events.length > 120) s.events.shift();
}

export const snap = (c: Card): Snap => ({ name: c.name, img: c.img, power: c.power, kind: c.kind, words: c.words, hue: c.hue });

/** 罠など、ダメージの後に割り込む処理を traps.ts が登録する */
export const hooks: { afterDamage?: (s: State, p: P, n: number) => void } = {};

export function checkWin(s: State): void {
  if (s.winner !== null) return;
  const a = s.lp[0] <= 0;
  const b = s.lp[1] <= 0;
  if (a && b) s.winner = 'draw';
  else if (a) s.winner = 1;
  else if (b) s.winner = 0;
  if (s.winner !== null) log(s, s.winner === 'draw' ? '引き分け！' : `${s.names[s.winner]} の勝ち！`);
}

export function damage(s: State, p: P, n: number): void {
  n = Math.max(0, Math.round(n));
  if (!n || s.winner !== null) return;
  s.lp[p] = Math.max(0, s.lp[p] - n);
  log(s, `${s.names[p]} に ${n} ダメージ（LP ${s.lp[p]}）`);
  emit(s, { t: 'damage', p, n });
  hooks.afterDamage?.(s, p, n); // 罠で持ち直せるよう、勝敗の前に呼ぶ
  checkWin(s);
}

export function heal(s: State, p: P, n: number): void {
  n = Math.max(0, Math.round(n));
  if (!n) return;
  s.lp[p] += n;
  log(s, `${s.names[p]} が ${n} 回復（LP ${s.lp[p]}）`);
  emit(s, { t: 'heal', p, n });
}

export function setLp(s: State, p: P, n: number): void {
  const before = s.lp[p];
  s.lp[p] = Math.max(0, Math.round(n));
  log(s, `${s.names[p]} の LP が ${s.lp[p]} になった`);
  if (s.lp[p] > before) emit(s, { t: 'heal', p, n: s.lp[p] - before });
  else if (s.lp[p] < before) emit(s, { t: 'damage', p, n: before - s.lp[p] });
  checkWin(s);
}

/** デッキが無いのに引くと負け（遊戯王と同じ） */
export function draw(s: State, p: P, n: number): void {
  for (let i = 0; i < n && s.winner === null; i++) {
    const c = s.deck[p].shift();
    if (!c) {
      s.winner = foe(p);
      log(s, `${s.names[p]} はデッキ切れ。${s.names[foe(p)]} の勝ち！`);
      return;
    }
    s.hand[p].push(c);
    log(s, `${s.names[p]} が 1 枚引いた`);
  }
}

export function sendToGrave(s: State, p: P, card: Card): void {
  card.power = card.base;
  s.grave[p].push(card);
}

export function destroyAt(s: State, p: P, slot: number): boolean {
  const c = s.field[p][slot];
  if (!c) return false;
  if (s.immortal.includes(c.id)) {
    s.immortal = s.immortal.filter((i) => i !== c.id);
    log(s, `${c.name} は不死身の力で壊れなかった`);
    emit(s, { t: 'popup', p, text: '不死身！' });
    return false;
  }
  emit(s, { t: 'destroy', p, slot, card: snap(c) });
  s.field[p][slot] = null;
  sendToGrave(s, p, c);
  log(s, `${c.name} が破壊された`);
  return true;
}

export function fieldCards(s: State, p: P): { card: Card; slot: number }[] {
  return s.field[p].flatMap((card, slot) => (card ? [{ card, slot }] : []));
}

/** 飲む場面を出す。押してもらうまで次へ進まない */
export function drink(s: State, p: P, n: number): void {
  if (n <= 0) return;
  s.drinks[p] += n;
  log(s, `${s.names[p]} が ${n} 口のむ`);
  emit(s, { t: 'drink', p, n });
  s.prompts.push({
    text: `${s.names[p]} は ${n} 口のむ！`,
    owner: p,
    pending: null,
    choices: [{ label: 'のんだ！', drinks: 0, mult: 1, add: 0, skip: false, penalty: 0 }],
  });
}

export function ask(s: State, prompt: Prompt): void {
  s.prompts.push(prompt);
}

export const plain = (label: string, o: Partial<Choice> = {}): Choice => ({ label, drinks: 0, mult: 1, add: 0, skip: false, penalty: 0, ...o });
