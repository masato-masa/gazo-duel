export type P = 0 | 1;

export interface Effect {
  part: string;
  n: number;
}

export interface Card {
  id: string;
  name: string;
  /** 場にいる間の戦闘力（効果で変わる）。手札・墓地に戻ると base に戻る */
  power: number;
  base: number;
  effects: Effect[];
  /** 画像の URL（アップロード画像）。無いときは words から作った色 */
  img: string;
  /** 画像に近かった言葉（英語）。3 つ */
  words: string[];
}

/** 画面に出して、飲む・やる・結果を押してもらう場面 */
export interface PromptChoice {
  label: string;
  eff: Effect;
  /** 効果を実行する側（'owner' = 出した人。ダメージ系は実行者の相手に当たる） */
  who: 'owner' | 'foe';
}
export interface Prompt {
  text: string;
  owner: P;
  choices: PromptChoice[];
}

export interface State {
  names: [string, string];
  lp: [number, number];
  deck: Card[][];
  hand: Card[][];
  field: (Card | null)[][];
  grave: Card[][];
  turn: P;
  turnNo: number;
  summonsLeft: number;
  /** このターンに出した枚数（効果で出し直す無限ループを止める） */
  summonCount: number;
  attacked: string[];
  sealed: string[];
  immortal: string[];
  skipDraw: [boolean, boolean];
  poison: [{ n: number; t: number }, { n: number; t: number }];
  regen: [{ n: number; t: number }, { n: number; t: number }];
  drinks: [number, number];
  log: string[];
  prompts: Prompt[];
  winner: P | 'draw' | null;
  seed: number;
}

export const SLOTS = 3;
export const START_LP = 4000;
export const START_HAND = 3;
