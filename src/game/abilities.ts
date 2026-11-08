import { ask, damage, destroyAt, draw, drink, emit, fieldCards, foe, heal, log, pick, plain, rand, sendToGrave, setLp } from './ops';
import type { Ability, Card, Choice, CondKind, P, Prompt, Scale, State } from './types';

export interface Ctx {
  s: State;
  me: P;
  /** 能力を出したカード（場に無いこともある） */
  card: Card | null;
}

/** lp = LP や戦闘力の増減（100 刻み）、count = 枚数・口数、none = 数を使わない */
export type Unit = 'lp' | 'count' | 'none';

export interface Action {
  id: string;
  unit: Unit;
  range: [number, number, number];
  text: (v: number, flip: boolean) => string;
  run: (c: Ctx, v: number, flip: boolean) => void;
}

type FC = { card: Card; slot: number };
const strongest = (cs: FC[]) => cs.reduce<FC | undefined>((a, b) => (!a || b.card.power > a.card.power ? b : a), undefined);
const weakest = (cs: FC[]) => cs.reduce<FC | undefined>((a, b) => (!a || b.card.power < a.card.power ? b : a), undefined);
const addPower = (card: Card, d: number) => {
  card.power = Math.max(0, card.power + d);
};
function takeRandom(s: State, p: P): Card | undefined {
  const h = s.hand[p];
  return h.length ? h.splice(Math.floor(rand(s) * h.length), 1)[0] : undefined;
}
/** flip=false のときの「得をする側 / 損をさせる側」を向きで決める */
const good = (c: Ctx, flip: boolean): P => (flip ? foe(c.me) : c.me);
const bad = (c: Ctx, flip: boolean): P => (flip ? c.me : foe(c.me));

export const ACTIONS: Action[] = [
  // ---- LP・戦闘力
  { id: 'heal', unit: 'lp', range: [300, 1500, 100], text: (v, f) => `${f ? '相手' : '自分'}の LP を ${v} 回復`, run: (c, v, f) => heal(c.s, good(c, f), v) },
  { id: 'damage', unit: 'lp', range: [300, 1500, 100], text: (v, f) => `${f ? '自分' : '相手'}に ${v} ダメージ`, run: (c, v, f) => damage(c.s, bad(c, f), v) },
  {
    id: 'powerUp', unit: 'lp', range: [300, 1500, 100],
    text: (v, f) => `${f ? '相手の場でいちばん強いカード' : 'このカード'}の戦闘力 +${v}`,
    run: (c, v, f) => {
      const t = f ? strongest(fieldCards(c.s, foe(c.me)))?.card : c.card;
      if (t) addPower(t, v);
    },
  },
  {
    id: 'powerDown', unit: 'lp', range: [300, 1200, 100],
    text: (v, f) => `${f ? '自分' : '相手'}の場の全カードの戦闘力 −${v}`,
    run: (c, v, f) => fieldCards(c.s, bad(c, f)).forEach((x) => addPower(x.card, -v)),
  },
  {
    id: 'poison', unit: 'lp', range: [100, 500, 100],
    text: (v, f) => `${f ? '自分' : '相手'}のターン開始時、3 回 ${v} ダメージ`,
    run: (c, v, f) => {
      c.s.poison[bad(c, f)] = { n: v, t: 3 };
    },
  },
  {
    id: 'regen', unit: 'lp', range: [100, 400, 100],
    text: (v, f) => `${f ? '相手' : '自分'}のターン開始時、3 回 LP を ${v} 回復`,
    run: (c, v, f) => {
      c.s.regen[good(c, f)] = { n: v, t: 3 };
    },
  },
  // ---- 枚数・口数
  { id: 'draw', unit: 'count', range: [1, 2, 1], text: (v, f) => `${f ? '相手' : '自分'}がカードを ${v} 枚引く`, run: (c, v, f) => draw(c.s, good(c, f), v) },
  {
    id: 'discard', unit: 'count', range: [1, 2, 1],
    text: (v, f) => `${f ? '自分' : '相手'}の手札をランダムに ${v} 枚捨てる`,
    run: (c, v, f) => {
      const p = bad(c, f);
      for (let i = 0; i < v; i++) {
        const x = takeRandom(c.s, p);
        if (!x) break;
        sendToGrave(c.s, p, x);
        log(c.s, `${x.name} が捨てられた`);
      }
    },
  },
  {
    id: 'mill', unit: 'count', range: [1, 2, 1],
    text: (v, f) => `${f ? '自分' : '相手'}のデッキの上から ${v} 枚を墓地へ送る`,
    run: (c, v, f) => {
      const p = bad(c, f);
      for (let i = 0; i < v; i++) {
        const x = c.s.deck[p].shift();
        if (x) sendToGrave(c.s, p, x);
      }
    },
  },
  { id: 'drinkFoe', unit: 'count', range: [1, 3, 1], text: (v, f) => `${f ? '自分' : '相手'}が ${v} 口のむ`, run: (c, v, f) => drink(c.s, bad(c, f), v) },
  // ---- 数を使わない（変な効果）
  {
    id: 'destroy', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '自分の場の他のカード' : '相手の場のカード'}をランダムに 1 枚破壊`,
    run: (c, _v, f) => {
      const p = bad(c, f);
      const t = pick(c.s, fieldCards(c.s, p).filter((x) => x.card !== c.card));
      if (t) destroyAt(c.s, p, t.slot);
    },
  },
  {
    id: 'halve', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '自分' : '相手'}の場でいちばん強いカードの戦闘力を半分に`,
    run: (c, _v, f) => {
      const t = strongest(fieldCards(c.s, bad(c, f)));
      if (t) t.card.power = Math.floor(t.card.power / 2);
    },
  },
  {
    id: 'mirror', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => (f ? '相手の場でいちばん弱いカードの戦闘力を、このカードと同じにする' : 'このカードの戦闘力を、相手の場でいちばん強いカードと同じにする'),
    run: (c, _v, f) => {
      if (!c.card) return;
      if (f) {
        const t = weakest(fieldCards(c.s, foe(c.me)));
        if (t) t.card.power = c.card.power;
      } else {
        const t = strongest(fieldCards(c.s, foe(c.me)));
        if (t) c.card.power = t.card.power;
      }
    },
  },
  {
    id: 'swapPower', unit: 'none', range: [0, 0, 1],
    text: () => '自分と相手の場から 1 枚ずつ選び、戦闘力を入れ替える',
    run: (c) => {
      const a = pick(c.s, fieldCards(c.s, c.me));
      const b = pick(c.s, fieldCards(c.s, foe(c.me)));
      if (a && b) [a.card.power, b.card.power] = [b.card.power, a.card.power];
    },
  },
  {
    id: 'swapLp', unit: 'none', range: [0, 0, 1],
    text: () => '自分と相手の LP を入れ替える',
    run: (c) => {
      const [a, b] = [c.s.lp[c.me], c.s.lp[foe(c.me)]];
      setLp(c.s, c.me, b);
      setLp(c.s, foe(c.me), a);
    },
  },
  {
    id: 'averageLp', unit: 'none', range: [0, 0, 1],
    text: () => '両者の LP を平均にそろえる',
    run: (c) => {
      const m = Math.round((c.s.lp[0] + c.s.lp[1]) / 2 / 100) * 100;
      setLp(c.s, 0, m);
      setLp(c.s, 1, m);
    },
  },
  {
    id: 'lp3333', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '相手' : '自分'}の LP を 3333 にする（増える人も減る人もいる）`,
    run: (c, _v, f) => setLp(c.s, good(c, f), 3333),
  },
  {
    id: 'lp20', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '自分' : '相手'}の LP を 2 割減らす`,
    run: (c, _v, f) => damage(c.s, bad(c, f), c.s.lp[bad(c, f)] * 0.2),
  },
  {
    id: 'steal', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => (f ? '自分の手札を 1 枚、相手に押しつける' : '相手の手札を 1 枚ランダムに奪う'),
    run: (c, _v, f) => {
      const from = f ? c.me : foe(c.me);
      const x = takeRandom(c.s, from);
      if (!x) return;
      c.s.hand[foe(from)].push(x);
      log(c.s, `${x.name} が ${c.s.names[foe(from)]} の手札へ`);
    },
  },
  {
    id: 'returnCard', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '自分' : '相手'}の場のカードを 1 枚、持ち主の手札に戻す`,
    run: (c, _v, f) => {
      const p = bad(c, f);
      const t = pick(c.s, fieldCards(c.s, p).filter((x) => x.card !== c.card));
      if (!t) return;
      c.s.field[p][t.slot] = null;
      t.card.power = t.card.base;
      c.s.hand[p].push(t.card);
      log(c.s, `${t.card.name} が手札に戻った`);
    },
  },
  {
    id: 'revive', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '相手' : '自分'}の墓地のカードを 1 枚、手札に戻す`,
    run: (c, _v, f) => {
      const p = good(c, f);
      const g = c.s.grave[p];
      if (!g.length) return;
      const x = g.splice(Math.floor(rand(c.s) * g.length), 1)[0];
      c.s.hand[p].push(x);
      log(c.s, `${x.name} が墓地から戻った`);
    },
  },
  {
    id: 'immortal', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '相手の場のカード 1 枚' : 'このカード'}は次に受ける破壊を 1 度だけ防ぐ`,
    run: (c, _v, f) => {
      const t = f ? pick(c.s, fieldCards(c.s, foe(c.me)))?.card : c.card;
      if (t) c.s.immortal.push(t.id);
    },
  },
  {
    id: 'seal', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => `${f ? '自分' : '相手'}の場のカード 1 枚を、次のターン攻撃できなくする`,
    run: (c, _v, f) => {
      const t = pick(c.s, fieldCards(c.s, bad(c, f)));
      if (t) c.s.sealed.push(t.card.id);
    },
  },
  { id: 'extraSummon', unit: 'none', range: [0, 0, 1], text: (_v, f) => `${f ? '相手' : '自分'}はこのターン、もう 1 枚出せる`, run: (c, _v, f) => { if (!f) c.s.summonsLeft += 1; } },
  { id: 'skipDraw', unit: 'none', range: [0, 0, 1], text: (_v, f) => `${f ? '自分' : '相手'}は次のターン、カードを引けない`, run: (c, _v, f) => { c.s.skipDraw[bad(c, f)] = true; } },
  { id: 'swapHands', unit: 'none', range: [0, 0, 1], text: () => '互いの手札を全部入れ替える', run: (c) => { [c.s.hand[0], c.s.hand[1]] = [c.s.hand[1], c.s.hand[0]]; } },
  {
    id: 'gift', unit: 'none', range: [0, 0, 1],
    text: (_v, f) => (f ? '相手の場のカード 1 枚を、自分の場へ移す' : 'このカードを相手の場に出す（相手のものになる）'),
    run: (c, _v, f) => {
      if (f) {
        const t = pick(c.s, fieldCards(c.s, foe(c.me)));
        const free = c.s.field[c.me].indexOf(null);
        if (t && free >= 0) {
          c.s.field[foe(c.me)][t.slot] = null;
          c.s.field[c.me][free] = t.card;
          log(c.s, `${t.card.name} を奪った`);
        }
        return;
      }
      if (!c.card) return;
      const mine = c.s.field[c.me].indexOf(c.card);
      const free = c.s.field[foe(c.me)].indexOf(null);
      if (mine < 0 || free < 0) return;
      c.s.field[c.me][mine] = null;
      c.s.field[foe(c.me)][free] = c.card;
      log(c.s, `${c.card.name} は相手の場へ移った`);
    },
  },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

// ---- 数値の出し方 -------------------------------------------------------

export const SCALES: Record<Scale, { text: (per: number) => string }> = {
  flat: { text: () => '' },
  perHand: { text: (p) => `さらに自分の手札 1 枚ごとに +${p}` },
  perField: { text: (p) => `さらに場のカード 1 枚ごとに +${p}（両者ぶん）` },
  perGrave: { text: (p) => `さらに自分の墓地 1 枚ごとに +${p}` },
  perDrunk: { text: (p) => `さらに飲んだ口数 1 口ごとに +${p}（両者の合計）` },
  perTurn: { text: (p) => `さらにお互い 1 回ずつ番が回るごとに +${p}` },
  dice: { text: (p) => `さらにサイコロの目 × ${p}` },
  lpGap: { text: () => 'さらに両者の LP の差の 1/4' },
};

function scaleBonus(s: State, owner: P, a: Ability): number {
  switch (a.scale) {
    case 'flat': return 0;
    case 'perHand': return a.per * s.hand[owner].length;
    case 'perField': return a.per * (fieldCards(s, 0).length + fieldCards(s, 1).length);
    case 'perGrave': return a.per * s.grave[owner].length;
    case 'perDrunk': return a.per * (s.drinks[0] + s.drinks[1]);
    case 'perTurn': return a.per * Math.floor(s.turnNo / 2);
    case 'dice': {
      const d = 1 + Math.floor(rand(s) * 6);
      log(s, `サイコロの目は ${d}`);
      return a.per * d;
    }
    case 'lpGap': return Math.round(Math.abs(s.lp[0] - s.lp[1]) / 4 / 100) * 100;
  }
}

// ---- 条件（ふざける部分） -----------------------------------------------

interface CondDef {
  /** unit ごとの説明文 */
  text: (a: Ability, unit: Unit) => string;
}

const COUNT_WORD: Record<string, string> = { draw: '枚', discard: '枚', mill: '枚', drinkFoe: '口' };
const bonusText = (a: Ability, unit: Unit): string => (unit === 'count' ? `1 ${COUNT_WORD[a.action] ?? '枚'}ふえる` : `+${a.condN}`);
const COND_TEXT: Record<CondKind, CondDef> = {
  none: { text: () => '' },
  sake: { text: (a, u) => `お酒を飲んでもよい（1 口につき ${bonusText(a, u)}、最大 3 口）` },
  rps: { text: (_a, u) => (u === 'none' ? 'じゃんけんに負けたら不発で 1 口のむ' : 'じゃんけんに勝てば 2 倍、負ければ不発で 1 口のむ') },
  name: { text: (_a, u) => (u === 'none' ? '名前を早口で 3 回言う。噛んだら不発で 1 口のむ' : '名前を早口で 3 回言えれば 1.5 倍、噛んだら不発で 1 口のむ') },
  shame: { text: (a, u) => `最近の恥ずかしかった話ができれば ${bonusText(a, u)}、できなければ不発で 1 口のむ` },
  praise: { text: (a, u) => `相手のいいところを 3 つ言えれば ${bonusText(a, u)}、言えなければ不発で 1 口のむ` },
  imitate: { text: (_a, u) => (u === 'none' ? 'ものまねで相手が笑わなければ不発' : 'ものまねで相手が笑えば 2 倍、笑わなければ半分') },
  coin: { text: (_a, u) => (u === 'none' ? 'コインを投げて、裏なら不発' : 'コインを投げて、表なら 2 倍、裏なら半分') },
  parity: { text: (_a, u) => (u === 'none' ? '手札が奇数枚なら不発' : '手札が偶数枚なら 2 倍、奇数枚なら半分') },
};

/** 数を使わない動作に付けてよい条件（倍率や加算が意味を持たない） */
export const NONE_UNIT_CONDS: CondKind[] = ['none', 'rps', 'name', 'imitate', 'coin', 'parity'];

// ---- 文章 ---------------------------------------------------------------

export function abilityText(a: Ability): string {
  const act = ACTION_BY_ID.get(a.action)!;
  const sc = SCALES[a.scale].text(a.per);
  const base = act.unit === 'none' ? act.text(0, a.flip) : act.text(a.n, a.flip) + (sc ? `。${sc}` : '');
  const cond = COND_TEXT[a.cond].text(a, act.unit);
  return cond ? `${cond}
▶ ${base}` : base;
}

// ---- 発動 ---------------------------------------------------------------

export interface Mods {
  mult: number;
  add: number;
  skip: boolean;
}

function findCard(s: State, id: string): { card: Card; owner: P } | null {
  for (const p of [0, 1] as P[]) {
    const c = [...s.field[p], ...s.traps[p]].find((x) => x?.id === id);
    if (c) return { card: c, owner: p };
  }
  return null;
}

/** 条件に応じて、そのまま発動 / 問いを出す / 自動で判定する */
export function fire(s: State, owner: P, card: Card, ability: Ability): void {
  const act = ACTION_BY_ID.get(ability.action)!;
  const unit = act.unit;
  const pending = { cardId: card.id, cardName: card.name, ability };
  const unitAdd = (k: number) => (unit === 'count' ? k : k * ability.condN);
  const q = (text: string, choices: Choice[]) => ask(s, { text: `${s.names[owner]}：${text}`, owner, pending, choices });
  switch (ability.cond) {
    case 'none': return apply(s, owner, card, ability, { mult: 1, add: 0, skip: false });
    case 'coin': {
      const heads = rand(s) < 0.5;
      log(s, `コインは${heads ? '表' : '裏'}`);
      emit(s, { t: 'popup', p: owner, text: heads ? 'コイン：表' : 'コイン：裏' });
      return apply(s, owner, card, ability, { mult: heads ? 2 : 0.5, add: 0, skip: false });
    }
    case 'parity': {
      const even = s.hand[owner].length % 2 === 0;
      log(s, `手札は ${s.hand[owner].length} 枚（${even ? '偶数' : '奇数'}）`);
      emit(s, { t: 'popup', p: owner, text: even ? '手札：偶数' : '手札：奇数' });
      return apply(s, owner, card, ability, { mult: even ? 2 : 0.5, add: 0, skip: false });
    }
    case 'sake':
      return q(`「${card.name}」お酒を飲みますか？ 1 口につき ${bonusText(ability, unit)}`, [
        plain('飲まない'),
        ...[1, 2, 3].map((k) => plain(`${k} 口のむ（+${unitAdd(k)}${unit === 'count' ? COUNT_WORD[ability.action] ?? '' : ''}）`, { drinks: k, add: unitAdd(k) })),
      ]);
    case 'rps':
      return q('じゃんけんをしてください。結果は？', [
        plain('勝った（2 倍）', { mult: 2 }),
        plain('あいこ'),
        plain('負けた（不発・1 口のむ）', { skip: true, penalty: 1 }),
      ]);
    case 'name':
      return q(`「${card.name}」を早口で 3 回言ってください`, [
        plain('言えた（1.5 倍）', { mult: 1.5 }),
        plain('噛んだ（不発・1 口のむ）', { skip: true, penalty: 1 }),
      ]);
    case 'shame':
      return q('最近の恥ずかしかった話を 1 つしてください', [
        plain(`話せた（${bonusText(ability, unit)}）`, { add: unitAdd(1) }),
        plain('話せない（不発・1 口のむ）', { skip: true, penalty: 1 }),
      ]);
    case 'praise':
      return q(`${s.names[foe(owner)]} のいいところを 3 つ言ってください`, [
        plain(`言えた（${bonusText(ability, unit)}）`, { add: unitAdd(1) }),
        plain('言えない（不発・1 口のむ）', { skip: true, penalty: 1 }),
      ]);
    case 'imitate':
      return q(`「${card.name}」のものまねをしてください`, [
        plain('相手が笑った（2 倍）', { mult: 2 }),
        plain('笑わない（半分）', { mult: 0.5 }),
      ]);
  }
}

/** 問いの答えを受けて、飲んで、能力を発動する */
export function answer(s: State, owner: P, pending: NonNullable<Prompt['pending']>, ch: Choice): void {
  if (ch.drinks > 0) drink(s, owner, ch.drinks);
  const found = findCard(s, pending.cardId);
  const card = found?.card ?? null;
  if (ch.skip) {
    log(s, `「${pending.cardName}」は不発`);
    emit(s, { t: 'popup', p: owner, text: '不発…' });
    if (ch.penalty > 0) drink(s, owner, ch.penalty);
    return;
  }
  apply(s, owner, card, pending.ability, { mult: ch.mult, add: ch.add, skip: false }, pending.cardName);
}

export function apply(s: State, owner: P, card: Card | null, a: Ability, mods: Mods, name = card?.name ?? ''): void {
  const act = ACTION_BY_ID.get(a.action)!;
  if (act.unit === 'none' && mods.mult < 1) {
    log(s, `「${name}」は不発`);
    emit(s, { t: 'popup', p: owner, text: '不発…' });
    return;
  }
  let v = a.n + scaleBonus(s, owner, a);
  v = v * mods.mult + mods.add;
  if (act.unit === 'lp') v = Math.max(0, Math.round(v / 100) * 100);
  else if (act.unit === 'count') v = Math.max(1, Math.round(v));
  const text = act.text(v, a.flip);
  log(s, `効果：${text}`);
  emit(s, { t: 'ability', p: owner, name, text });
  act.run({ s, me: owner, card }, v, a.flip);
}
