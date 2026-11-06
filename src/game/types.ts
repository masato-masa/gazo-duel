export type P = 0 | 1;

/** 数値の出し方。flat 以外は「基本値 + 状況 × per」 */
export type Scale = 'flat' | 'perHand' | 'perField' | 'perGrave' | 'perDrunk' | 'perTurn' | 'dice' | 'lpGap';

/** 能力のおまけ条件（ふざける部分）。none 以外は発動のしかたが変わる */
export type CondKind = 'none' | 'sake' | 'rps' | 'name' | 'shame' | 'praise' | 'imitate' | 'coin' | 'parity';

/** 1 枚のカードの能力は 1 つ。動作 × 向き × 数値の出し方 × 条件 の組み合わせでできる */
export interface Ability {
  action: string;
  /** 基本値（LP や戦闘力なら 100 刻み、枚数・口数なら 1 刻み） */
  n: number;
  /** 向きを反転する（回復が相手に付く、ダメージが自分に返る…） */
  flip: boolean;
  scale: Scale;
  /** scale の 1 単位あたり */
  per: number;
  cond: CondKind;
  /** 条件の加算量（お酒 1 口あたりなど） */
  condN: number;
}

export type TrapTrigger = 'attack' | 'direct' | 'summon' | 'hurt' | 'low';
export type TrapCore =
  | 'negateAttack' | 'destroyAttacker' | 'reflectAttacker' | 'halveAttacker'
  | 'negateSummon' | 'destroySummoned'
  | 'healHalf' | 'mirrorDamage'
  | 'healFull' | 'wipeFoe' | 'draw3';

export interface Card {
  id: string;
  kind: 'monster' | 'trap';
  name: string;
  /** 場にいる間の戦闘力（効果で変わる）。手札・墓地に戻ると base に戻る。罠は 0 */
  power: number;
  base: number;
  ability: Ability | null;
  /** 罠だけ: 発動のきっかけと、そのとき必ず起こること。ability は「さらに」の部分 */
  trap: { trigger: TrapTrigger; core: TrapCore } | null;
  /** 画像の URL（アップロード画像）。無いときは言葉から作った絵 */
  img: string;
  /** 画像に近かった言葉（英語）。3 つ */
  words: string[];
  /** 絵の色味を決める種 */
  hue: number;
}

export interface Choice {
  label: string;
  /** 飲む口数（選んだ人が飲む） */
  drinks: number;
  mult: number;
  add: number;
  /** true なら能力は発動しない */
  skip: boolean;
  /** 発動しなかったときの罰の口数 */
  penalty: number;
}

/** 画面に出して、飲む・やる・結果を押してもらう場面 */
export interface Prompt {
  text: string;
  owner: P;
  /** 続きで発動する能力 */
  pending: { cardId: string; cardName: string; ability: Ability } | null;
  choices: Choice[];
}

/** 画面の演出用の出来事。状態には影響しない */
export type Snap = Pick<Card, 'name' | 'img' | 'power' | 'kind' | 'words' | 'hue'>;
export type GameEvent = { id: number } & (
  | { t: 'damage'; p: P; n: number }
  | { t: 'heal'; p: P; n: number }
  | { t: 'summon'; p: P; slot: number }
  | { t: 'attack'; p: P; slot: number; target: number | 'direct' }
  | { t: 'destroy'; p: P; slot: number; card: Snap }
  | { t: 'trapSet'; p: P; slot: number }
  | { t: 'trap'; p: P; slot: number; card: Snap; text: string }
  | { t: 'ability'; p: P; name: string; text: string }
  | { t: 'drink'; p: P; n: number }
  | { t: 'popup'; p: P; text: string }
);

export interface State {
  names: [string, string];
  lp: [number, number];
  deck: Card[][];
  hand: Card[][];
  field: (Card | null)[][];
  traps: (Card | null)[][];
  grave: Card[][];
  turn: P;
  turnNo: number;
  summonsLeft: number;
  /** このターンに出した枚数（効果で出し直す無限ループを止める） */
  summonCount: number;
  trapSetsLeft: number;
  attacked: string[];
  sealed: string[];
  immortal: string[];
  skipDraw: [boolean, boolean];
  poison: [{ n: number; t: number }, { n: number; t: number }];
  regen: [{ n: number; t: number }, { n: number; t: number }];
  drinks: [number, number];
  log: string[];
  prompts: Prompt[];
  events: GameEvent[];
  eventSeq: number;
  /** 罠の処理中（入れ子で別の罠を発動させない） */
  inTrap: boolean;
  winner: P | 'draw' | null;
  seed: number;
}

export const SLOTS = 3;
export const TRAP_SLOTS = 3;
export const START_LP = 4000;
export const START_HAND = 3;
