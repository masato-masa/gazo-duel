import type { Card, Effect, P, State } from './types';
import { ask, damage, destroyAt, draw, drink, fieldCards, foe, heal, log, pick, rand, sendToGrave, setLp } from './ops';

export interface Ctx {
  s: State;
  me: P;
  /** 効果を出したカード（場に無いこともある） */
  card: Card | null;
}

export interface Part {
  id: string;
  /** n の取りうる値: [最小, 最大, 刻み]。使わない部品は [0,0,1] */
  range: [number, number, number];
  label: (n: number) => string;
  run: (c: Ctx, n: number) => void;
}

type FC = { card: Card; slot: number };
const onField = (c: Ctx): boolean => !!c.card && c.s.field[c.me].includes(c.card);
const power = (card: Card, d: number) => {
  card.power = Math.max(0, card.power + d);
};
const strongest = (cs: FC[]) => cs.reduce<FC | undefined>((a, b) => (!a || b.card.power > a.card.power ? b : a), undefined);
const weakest = (cs: FC[]) => cs.reduce<FC | undefined>((a, b) => (!a || b.card.power < a.card.power ? b : a), undefined);

/** 手札からランダムに 1 枚抜く */
function takeRandom(s: State, p: P): Card | undefined {
  const h = s.hand[p];
  if (!h.length) return undefined;
  return h.splice(Math.floor(rand(s) * h.length), 1)[0];
}

export const PARTS: Part[] = [
  // ---- ふつうの効果
  { id: 'heal', range: [300, 1500, 100], label: (n) => `自分のLPを ${n} 回復`, run: (c, n) => heal(c.s, c.me, n) },
  { id: 'damage', range: [300, 1500, 100], label: (n) => `相手に ${n} ダメージ`, run: (c, n) => damage(c.s, foe(c.me), n) },
  { id: 'draw', range: [1, 2, 1], label: (n) => `カードを ${n} 枚引く`, run: (c, n) => draw(c.s, c.me, n) },
  { id: 'selfUp', range: [300, 1500, 100], label: (n) => `このカードの戦闘力 +${n}`, run: (c, n) => { if (c.card) power(c.card, n); } },
  { id: 'selfDown', range: [300, 1500, 100], label: (n) => `このカードの戦闘力 −${n}`, run: (c, n) => { if (c.card) power(c.card, -n); } },
  { id: 'selfDouble', range: [0, 0, 1], label: () => 'このカードの戦闘力を 2 倍', run: (c) => { if (c.card) c.card.power *= 2; } },
  {
    id: 'oppDiscard', range: [1, 2, 1], label: (n) => `相手の手札をランダムに ${n} 枚捨てさせる`,
    run: (c, n) => {
      for (let i = 0; i < n; i++) {
        const x = takeRandom(c.s, foe(c.me));
        if (!x) break;
        sendToGrave(c.s, foe(c.me), x);
        log(c.s, `${x.name} が捨てられた`);
      }
    },
  },
  {
    id: 'selfDiscard', range: [0, 0, 1], label: () => '自分の手札をランダムに 1 枚捨てる',
    run: (c) => {
      const x = takeRandom(c.s, c.me);
      if (!x) return;
      sendToGrave(c.s, c.me, x);
      log(c.s, `${x.name} を捨てた`);
    },
  },
  {
    id: 'destroyFoe', range: [0, 0, 1], label: () => '相手の場のカードをランダムに 1 枚破壊',
    run: (c) => {
      const t = pick(c.s, fieldCards(c.s, foe(c.me)));
      if (t) destroyAt(c.s, foe(c.me), t.slot);
    },
  },
  {
    id: 'destroyOwn', range: [0, 0, 1], label: () => '自分の場の他のカードをランダムに 1 枚破壊',
    run: (c) => {
      const t = pick(c.s, fieldCards(c.s, c.me).filter((x) => x.card !== c.card));
      if (t) destroyAt(c.s, c.me, t.slot);
    },
  },
  { id: 'weakenFoe', range: [300, 1200, 100], label: (n) => `相手の場の全カードの戦闘力 −${n}`, run: (c, n) => fieldCards(c.s, foe(c.me)).forEach((x) => power(x.card, -n)) },
  { id: 'boostOwn', range: [300, 1200, 100], label: (n) => `自分の場の他の全カードの戦闘力 +${n}`, run: (c, n) => fieldCards(c.s, c.me).filter((x) => x.card !== c.card).forEach((x) => power(x.card, n)) },
  {
    id: 'halveStrong', range: [0, 0, 1], label: () => '相手の場でいちばん強いカードの戦闘力を半分に',
    run: (c) => {
      const t = strongest(fieldCards(c.s, foe(c.me)));
      if (t) t.card.power = Math.floor(t.card.power / 2);
    },
  },
  {
    id: 'copyStrong', range: [0, 0, 1], label: () => 'このカードの戦闘力を、相手の場でいちばん強いカードと同じにする',
    run: (c) => {
      const t = strongest(fieldCards(c.s, foe(c.me)));
      if (t && c.card) c.card.power = t.card.power;
    },
  },
  {
    id: 'pullWeak', range: [0, 0, 1], label: () => '相手の場でいちばん弱いカードの戦闘力を、このカードと同じにする',
    run: (c) => {
      const t = weakest(fieldCards(c.s, foe(c.me)));
      if (t && c.card) t.card.power = c.card.power;
    },
  },
  {
    id: 'swapPower', range: [0, 0, 1], label: () => '自分と相手の場から 1 枚ずつ選び、戦闘力を入れ替える',
    run: (c) => {
      const a = pick(c.s, fieldCards(c.s, c.me));
      const b = pick(c.s, fieldCards(c.s, foe(c.me)));
      if (a && b) [a.card.power, b.card.power] = [b.card.power, a.card.power];
    },
  },
  {
    id: 'zeroHeal', range: [0, 0, 1], label: () => 'このカードの戦闘力を 0 にして、LPを 1000 回復',
    run: (c) => {
      if (c.card) c.card.power = 0;
      heal(c.s, c.me, 1000);
    },
  },
  { id: 'regen', range: [100, 400, 100], label: (n) => `自分のターン開始時、3 回 LP を ${n} 回復`, run: (c, n) => { c.s.regen[c.me] = { n, t: 3 }; } },
  { id: 'poison', range: [100, 500, 100], label: (n) => `相手のターン開始時、3 回 ${n} ダメージ`, run: (c, n) => { c.s.poison[foe(c.me)] = { n, t: 3 }; } },
  {
    id: 'peekDamage', range: [0, 0, 1], label: () => '自分のデッキの一番上を墓地へ送り、その戦闘力ぶん相手にダメージ',
    run: (c) => {
      const x = c.s.deck[c.me].shift();
      if (!x) return;
      log(c.s, `${x.name}（戦闘力 ${x.base}）が墓地へ`);
      sendToGrave(c.s, c.me, x);
      damage(c.s, foe(c.me), x.base);
    },
  },
  {
    id: 'mill', range: [1, 2, 1], label: (n) => `相手のデッキの上から ${n} 枚を墓地へ送る`,
    run: (c, n) => {
      for (let i = 0; i < n; i++) {
        const x = c.s.deck[foe(c.me)].shift();
        if (x) sendToGrave(c.s, foe(c.me), x);
      }
    },
  },
  {
    id: 'powerHeal', range: [0, 0, 1], label: () => '自分の場の全カードの戦闘力の合計の 1/3 だけ回復',
    run: (c) => heal(c.s, c.me, Math.floor(fieldCards(c.s, c.me).reduce((a, x) => a + x.card.power, 0) / 3)),
  },
  { id: 'immortal', range: [0, 0, 1], label: () => 'このカードは次に受ける破壊を 1 度だけ防ぐ', run: (c) => { if (c.card) c.s.immortal.push(c.card.id); } },
  {
    id: 'seal', range: [0, 0, 1], label: () => '相手の場のカード 1 枚を、次の相手ターン攻撃できなくする',
    run: (c) => {
      const t = pick(c.s, fieldCards(c.s, foe(c.me)));
      if (t) c.s.sealed.push(t.card.id);
    },
  },
  { id: 'extraSummon', range: [0, 0, 1], label: () => 'このターン、もう 1 枚出せる', run: (c) => { c.s.summonsLeft += 1; } },
  { id: 'skipDraw', range: [0, 0, 1], label: () => '相手は次のターン、カードを引けない', run: (c) => { c.s.skipDraw[foe(c.me)] = true; } },
  {
    id: 'returnSelf', range: [0, 0, 1], label: () => 'このカードを手札に戻す',
    run: (c) => {
      if (!c.card || !onField(c)) return;
      c.s.field[c.me][c.s.field[c.me].indexOf(c.card)] = null;
      c.card.power = c.card.base;
      c.s.hand[c.me].push(c.card);
    },
  },
  {
    id: 'returnFoe', range: [0, 0, 1], label: () => '相手の場のカードを 1 枚、持ち主の手札に戻す',
    run: (c) => {
      const t = pick(c.s, fieldCards(c.s, foe(c.me)));
      if (!t) return;
      c.s.field[foe(c.me)][t.slot] = null;
      t.card.power = t.card.base;
      c.s.hand[foe(c.me)].push(t.card);
      log(c.s, `${t.card.name} が相手の手札に戻った`);
    },
  },
  {
    id: 'revive', range: [0, 0, 1], label: () => '自分の墓地のカードを 1 枚、手札に戻す',
    run: (c) => {
      const g = c.s.grave[c.me];
      if (!g.length) return;
      const x = g.splice(Math.floor(rand(c.s) * g.length), 1)[0];
      c.s.hand[c.me].push(x);
      log(c.s, `${x.name} が墓地から戻った`);
    },
  },
  // ---- 変な効果
  {
    id: 'swapLp', range: [0, 0, 1], label: () => '自分と相手の LP を入れ替える',
    run: (c) => {
      const [a, b] = [c.s.lp[c.me], c.s.lp[foe(c.me)]];
      setLp(c.s, c.me, b);
      setLp(c.s, foe(c.me), a);
    },
  },
  {
    id: 'averageLp', range: [0, 0, 1], label: () => '両者の LP を平均にそろえる',
    run: (c) => {
      const m = Math.round((c.s.lp[0] + c.s.lp[1]) / 2 / 100) * 100;
      setLp(c.s, 0, m);
      setLp(c.s, 1, m);
    },
  },
  { id: 'lp3333', range: [0, 0, 1], label: () => '自分の LP を 3333 にする（増える人も減る人もいる）', run: (c) => setLp(c.s, c.me, 3333) },
  { id: 'foeLp20', range: [0, 0, 1], label: () => '相手の LP を 2 割減らす', run: (c) => damage(c.s, foe(c.me), c.s.lp[foe(c.me)] * 0.2) },
  {
    id: 'steal', range: [0, 0, 1], label: () => '相手の手札を 1 枚ランダムに奪う',
    run: (c) => {
      const x = takeRandom(c.s, foe(c.me));
      if (!x) return;
      c.s.hand[c.me].push(x);
      log(c.s, `${x.name} を奪った`);
    },
  },
  {
    id: 'give', range: [0, 0, 1], label: () => '自分の手札を 1 枚、相手に押しつける',
    run: (c) => {
      const x = takeRandom(c.s, c.me);
      if (!x) return;
      c.s.hand[foe(c.me)].push(x);
      log(c.s, `${x.name} を相手に押しつけた`);
    },
  },
  { id: 'swapHands', range: [0, 0, 1], label: () => '互いの手札を全部入れ替える', run: (c) => { [c.s.hand[0], c.s.hand[1]] = [c.s.hand[1], c.s.hand[0]]; } },
  {
    id: 'mulligan', range: [0, 0, 1], label: () => '自分の手札を全部捨てて、同じ枚数を引き直す',
    run: (c) => {
      const k = c.s.hand[c.me].length;
      c.s.hand[c.me].splice(0).forEach((x) => sendToGrave(c.s, c.me, x));
      draw(c.s, c.me, k);
    },
  },
  {
    id: 'gift', range: [0, 0, 1], label: () => 'このカードを相手の場に出す（相手のものになる）',
    run: (c) => {
      if (!c.card || !onField(c)) return;
      const f = c.s.field[foe(c.me)];
      const free = f.indexOf(null);
      if (free < 0) return;
      c.s.field[c.me][c.s.field[c.me].indexOf(c.card)] = null;
      f[free] = c.card;
      log(c.s, `${c.card.name} は相手の場へ移った`);
    },
  },
  { id: 'selfHurt', range: [300, 1000, 100], label: (n) => `自分に ${n} ダメージ`, run: (c, n) => damage(c.s, c.me, n) },
  { id: 'foeHeal', range: [300, 1000, 100], label: (n) => `相手のLPを ${n} 回復`, run: (c, n) => heal(c.s, foe(c.me), n) },
  {
    id: 'flip', range: [400, 1500, 100], label: (n) => `コインを投げる。表なら相手に ${n} ダメージ、裏なら自分に ${Math.round(n / 200) * 100} ダメージ`,
    run: (c, n) => {
      if (rand(c.s) < 0.5) {
        log(c.s, 'コインは表');
        damage(c.s, foe(c.me), n);
      } else {
        log(c.s, 'コインは裏');
        damage(c.s, c.me, Math.round(n / 200) * 100);
      }
    },
  },
  {
    id: 'dice', range: [100, 300, 100], label: (n) => `サイコロを振る。出目 × ${n} を、奇数なら自分が回復、偶数なら相手がダメージ`,
    run: (c, n) => {
      const d = 1 + Math.floor(rand(c.s) * 6);
      log(c.s, `サイコロの目は ${d}`);
      if (d % 2) heal(c.s, c.me, d * n);
      else damage(c.s, foe(c.me), d * n);
    },
  },
  // ---- 飲みゲーの効果
  {
    id: 'drinkSelf', range: [1, 2, 1], label: (n) => `自分が ${n} 口のむ（のむと LP が ${n * 400} 回復）`,
    run: (c, n) => {
      drink(c.s, c.me, n);
      heal(c.s, c.me, n * 400);
    },
  },
  { id: 'drinkFoe', range: [1, 3, 1], label: (n) => `相手が ${n} 口のむ`, run: (c, n) => drink(c.s, foe(c.me), n) },
  {
    id: 'drinkAll', range: [1, 1, 1], label: () => '全員で乾杯。両者 1 口のむ',
    run: (c) => {
      drink(c.s, c.me, 1);
      drink(c.s, foe(c.me), 1);
    },
  },
  {
    id: 'drinkPower', range: [0, 0, 1], label: () => 'このカードの戦闘力 1000 ごとに、相手が 1 口のむ',
    run: (c) => {
      const k = c.card ? Math.floor(c.card.power / 1000) : 0;
      if (k) drink(c.s, foe(c.me), k);
    },
  },
  { id: 'silence', range: [0, 0, 1], label: () => '何も起こらない。ただし相手が 1 口のむ', run: (c) => drink(c.s, foe(c.me), 1) },
  {
    id: 'shame', range: [300, 1000, 100], label: (n) => `最近の恥ずかしかった話をする。話せたら相手に ${n} ダメージ、話せなければ 2 口のむ`,
    run: (c, n) =>
      ask(c.s, c.me, `${c.s.names[c.me]}：最近の恥ずかしかった話を 1 つしてください`, [
        { label: '話せた', eff: { part: 'damage', n }, who: 'owner' },
        { label: '話せない', eff: { part: 'drinkRaw', n: 2 }, who: 'owner' },
      ]),
  },
  {
    id: 'praise', range: [300, 1000, 100], label: (n) => `相手のいいところを 3 つ言う。言えたら自分が ${n} 回復、言えなければ 1 口のむ`,
    run: (c, n) =>
      ask(c.s, c.me, `${c.s.names[c.me]}：${c.s.names[foe(c.me)]} のいいところを 3 つ言ってください`, [
        { label: '言えた', eff: { part: 'heal', n }, who: 'owner' },
        { label: '言えない', eff: { part: 'drinkRaw', n: 1 }, who: 'owner' },
      ]),
  },
  {
    id: 'rps', range: [500, 1500, 100], label: (n) => `じゃんけんをする。負けた方が ${n} ダメージ、あいこなら両者 1 口のむ`,
    run: (c, n) =>
      ask(c.s, c.me, 'じゃんけんをしてください。結果は？', [
        { label: `${c.s.names[c.me]} の勝ち`, eff: { part: 'damage', n }, who: 'owner' },
        { label: 'あいこ', eff: { part: 'drinkAll', n: 1 }, who: 'owner' },
        { label: `${c.s.names[c.me]} の負け`, eff: { part: 'damage', n }, who: 'foe' },
      ]),
  },
  {
    id: 'nameTimes', range: [300, 1000, 100], label: (n) => `このカードの名前を早口で 3 回言う。言えたら相手に ${n} ダメージ、噛んだら 1 口のむ`,
    run: (c, n) =>
      ask(c.s, c.me, `「${c.card?.name ?? ''}」を早口で 3 回言ってください`, [
        { label: '言えた', eff: { part: 'damage', n }, who: 'owner' },
        { label: '噛んだ', eff: { part: 'drinkRaw', n: 1 }, who: 'owner' },
      ]),
  },
  {
    id: 'imitate', range: [300, 1000, 100], label: (n) => `このカードの絵のものまねをする。相手が笑ったら相手に ${n} ダメージ、笑わなければ自分が 1 口のむ`,
    run: (c, n) =>
      ask(c.s, c.me, `${c.s.names[c.me]}：「${c.card?.name ?? ''}」のものまねをしてください`, [
        { label: '相手が笑った', eff: { part: 'damage', n }, who: 'owner' },
        { label: '笑わない', eff: { part: 'drinkRaw', n: 1 }, who: 'owner' },
      ]),
  },
  // 内部用（選択肢の結果として呼ばれる。カードの効果にはならない）
  { id: 'drinkRaw', range: [1, 1, 1], label: (n) => `${n} 口のむ`, run: (c, n) => drink(c.s, c.me, n) },
  { id: 'nop', range: [0, 0, 1], label: () => '', run: () => undefined },
];

export const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));
/** カードの効果として選ばれうる部品 */
export const CARD_PARTS = PARTS.filter((p) => p.id !== 'drinkRaw' && p.id !== 'nop');

export function effectText(e: Effect): string {
  return PART_BY_ID.get(e.part)!.label(e.n);
}

export function runEffect(c: Ctx, e: Effect): void {
  PART_BY_ID.get(e.part)!.run(c, e.n);
}
