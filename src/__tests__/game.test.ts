import { describe, expect, it } from 'vitest';
import { ACTIONS, abilityText } from '../game/abilities';
import { cpuAct } from '../game/ai';
import { cardEffectText, randomCard, WORDS } from '../game/cardgen';
import { answerPrompt, attack, endTurn, newGame, setTrap, summon } from '../game/engine';
import { CORES_FOR } from '../game/traps';
import type { Ability, Card, State, TrapCore, TrapTrigger } from '../game/types';

const noAbility = null;
const mk = (name: string, power: number, ability: Ability | null = noAbility): Card => ({
  id: name, kind: 'monster', name, power, base: power, ability, trap: null, img: '', words: [], hue: 0,
});
const mkTrap = (name: string, trigger: TrapTrigger, core: TrapCore, ability: Ability | null = null): Card => ({
  id: name, kind: 'trap', name, power: 0, base: 0, ability, trap: { trigger, core }, img: '', words: [], hue: 0,
});
const ab = (action: string, p: Partial<Ability> = {}): Ability => ({ action, n: 500, flip: false, scale: 'flat', per: 0, cond: 'none', condN: 0, ...p });
const deck = (n: number, power = 1000) => Array.from({ length: 10 }, (_, i) => mk(`${n}-${i}`, power));

function game(): State {
  return newGame([{ name: 'A', cards: deck(0) }, { name: 'B', cards: deck(1) }], 1);
}

describe('辞書とカード', () => {
  it('辞書は 500 語以上、動作は 25 個以上', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(500);
    expect(ACTIONS.length).toBeGreaterThanOrEqual(25);
  });
  it('同じ種からは同じカードができる', () => {
    expect(randomCard(42, 'x')).toEqual(randomCard(42, 'x'));
  });
  it('モンスターは能力 1 つ・戦闘力 0〜2000、罠は戦闘力 0 できっかけを持つ。罠は 2〜4 割', () => {
    let traps = 0;
    for (let i = 0; i < 1000; i++) {
      const c = randomCard(i, 'x');
      expect(c.name.length).toBeGreaterThan(0);
      expect(cardEffectText(c).length).toBeGreaterThan(0);
      if (c.kind === 'trap') {
        traps++;
        expect(c.trap).not.toBeNull();
        expect(c.base).toBe(0);
        expect(CORES_FOR[c.trap!.trigger]).toContain(c.trap!.core);
      } else {
        expect(c.ability).not.toBeNull();
        expect(c.base).toBeGreaterThanOrEqual(0);
        expect(c.base).toBeLessThanOrEqual(2000);
      }
    }
    expect(traps).toBeGreaterThan(200);
    expect(traps).toBeLessThan(400);
  });
  it('数値の出し方・条件・向きが、カードごとにばらける', () => {
    const scales = new Set<string>();
    const conds = new Set<string>();
    let flips = 0;
    for (let i = 0; i < 1000; i++) {
      const a = randomCard(i, 'x').ability;
      if (!a) continue;
      scales.add(a.scale);
      conds.add(a.cond);
      if (a.flip) flips++;
    }
    expect(scales.size).toBeGreaterThanOrEqual(7);
    expect(conds.size).toBeGreaterThanOrEqual(8);
    expect(flips).toBeGreaterThan(50);
  });
});

describe('対戦の規則', () => {
  it('LP 4000・手札 3 枚で始まる', () => {
    const s = game();
    expect(s.lp).toEqual([4000, 4000]);
    expect(s.hand[0]).toHaveLength(3);
  });
  it('先攻の最初のターンは攻撃できない', () => {
    const s = game();
    summon(s, 0, 0);
    expect(attack(s, 0, 'direct')).toBe(false);
  });
  it('戦闘: 高い方が勝ち、差が負けた側の LP から引かれる。同値は両方壊れる', () => {
    const s = game();
    s.turnNo = 5;
    s.field[0][0] = mk('強', 2000);
    s.field[1][0] = mk('弱', 1500);
    attack(s, 0, 0);
    expect(s.field[1][0]).toBeNull();
    expect(s.lp[1]).toBe(3500);
    s.attacked = [];
    s.field[1][1] = mk('同', 2000);
    attack(s, 0, 1);
    expect(s.field[0][0]).toBeNull();
    expect(s.field[1][1]).toBeNull();
  });
  it('1 ターンに出せるのは 1 枚、攻撃は 1 体につき 1 回', () => {
    const s = game();
    expect(summon(s, 0, 0)).toBe(true);
    expect(summon(s, 0, 1)).toBe(false);
    s.turnNo = 5;
    s.field[1][0] = mk('的', 9999);
    expect(attack(s, 0, 0)).toBe(true);
    expect(attack(s, 0, 0)).toBe(false);
  });
  it('デッキが無いのに引くと負け／LP 0 で負け', () => {
    const s = game();
    s.deck[1] = [];
    endTurn(s);
    expect(s.winner).toBe(0);
    const t = game();
    t.turnNo = 5;
    t.lp[1] = 500;
    t.field[0][0] = mk('強', 2000);
    attack(t, 0, 'direct');
    expect(t.winner).toBe(0);
  });
});

describe('能力（動作 × 向き × 数値の出し方 × 条件）', () => {
  const play = (a: Ability, setup?: (s: State) => void): State => {
    const s = game();
    s.turnNo = 3;
    setup?.(s);
    s.hand[0].push(mk('試験', 1500, a));
    summon(s, s.hand[0].length - 1, 0);
    return s;
  };
  it('回復は自分、向きを反転すると相手が回復する', () => {
    {
      const s = play(ab('heal'));
      expect(s.lp).toEqual([4500, 4000]);
    }
    const f = play(ab('heal', { flip: true }));
    expect(f.lp).toEqual([4000, 4500]);
  });
  it('数値の出し方: 手札 1 枚につき加算', () => {
    const s = play(ab('damage', { scale: 'perHand', per: 100 }));
    // 試験カードを出した後の手札枚数 × 100 を 500 に足す
    expect(s.lp[1]).toBe(4000 - (500 + 100 * s.hand[0].length));
  });
  it('お酒: 飲むと 1 口につき加算し、飲んだ口数が数えられる', () => {
    const s = play(ab('damage', { cond: 'sake', condN: 100 }));
    expect(s.prompts[0].choices).toHaveLength(4);
    expect(s.lp[1]).toBe(4000); // まだ発動していない
    answerPrompt(s, 3); // 3 口
    expect(s.lp[1]).toBe(4000 - 800);
    expect(s.drinks[0]).toBe(3);
  });
  it('じゃんけんに負けると不発で 1 口', () => {
    const s = play(ab('damage', { cond: 'rps' }));
    answerPrompt(s, 2);
    expect(s.lp[1]).toBe(4000);
    expect(s.drinks[0]).toBe(1);
  });
  it('じゃんけんに勝つと 2 倍', () => {
    const s = play(ab('damage', { cond: 'rps' }));
    answerPrompt(s, 0);
    expect(s.lp[1]).toBe(3000);
  });
  it('どの動作も、向き・場の状態を変えても例外を出さない', () => {
    for (const act of ACTIONS) {
      for (const flip of [false, true]) {
        for (const mode of ['empty', 'full', 'nodeck']) {
          const s = game();
          s.turnNo = 3;
          if (mode === 'full') {
            for (let i = 0; i < 3; i++) {
              s.field[0][i] = mk(`a${i}`, 1000 + i * 500);
              s.field[1][i] = mk(`b${i}`, 800 + i * 700);
            }
          }
          if (mode === 'nodeck') s.deck = [[], []];
          const a = ab(act.id, { n: act.range[0], flip });
          s.hand[0].push(mk('試験', 1500, a));
          const idx = s.hand[0].length - 1;
          expect(() => summon(s, idx, 0), `${act.id} flip=${flip} ${mode}`).not.toThrow();
          expect(abilityText(a).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('罠', () => {
  const setup = (trap: Card): State => {
    const s = game();
    s.turnNo = 3;
    s.turn = 0;
    s.traps[1][0] = trap;
    return s;
  };
  it('罠は 1 ターンに 1 枚伏せられ、モンスターは伏せられない', () => {
    const s = game();
    s.hand[0].push(mkTrap('罠', 'attack', 'negateAttack'));
    expect(setTrap(s, 0, 0)).toBe(false);
    expect(setTrap(s, s.hand[0].length - 1, 0)).toBe(true);
    s.hand[0].push(mkTrap('罠2', 'attack', 'negateAttack'));
    expect(setTrap(s, s.hand[0].length - 1, 1)).toBe(false);
  });
  it('攻撃を無効にする罠: ダメージが通らず、罠は墓地へ行く', () => {
    const s = setup(mkTrap('壁', 'attack', 'negateAttack'));
    s.field[0][0] = mk('攻', 2000);
    s.field[1][0] = mk('守', 500);
    attack(s, 0, 0);
    expect(s.lp).toEqual([4000, 4000]);
    expect(s.field[1][0]).not.toBeNull();
    expect(s.traps[1][0]).toBeNull();
    expect(s.grave[1]).toHaveLength(1);
  });
  it('攻撃してきたカードを破壊する罠', () => {
    const s = setup(mkTrap('剣', 'attack', 'destroyAttacker'));
    s.field[0][0] = mk('攻', 2000);
    s.field[1][0] = mk('守', 500);
    attack(s, 0, 0);
    expect(s.field[0][0]).toBeNull();
  });
  it('直接攻撃には直接攻撃用の罠だけが反応する', () => {
    const s = setup(mkTrap('壁', 'attack', 'negateAttack'));
    s.field[0][0] = mk('攻', 1000);
    attack(s, 0, 'direct');
    expect(s.lp[1]).toBe(3000);
    expect(s.traps[1][0]).not.toBeNull();
  });
  it('相手がモンスターを出したとき、その効果を無効にする罠', () => {
    const s = setup(mkTrap('封', 'summon', 'negateSummon'));
    s.hand[0].push(mk('出', 1000, ab('damage')));
    summon(s, s.hand[0].length - 1, 0);
    expect(s.lp[1]).toBe(4000);
    expect(s.field[0][0]).not.toBeNull();
  });
  it('LP が 1500 以下になったとき持ち直す罠は、致死ダメージからも救う', () => {
    const s = setup(mkTrap('命', 'low', 'healFull'));
    s.lp[1] = 800;
    s.field[0][0] = mk('攻', 2000);
    attack(s, 0, 'direct');
    expect(s.winner).toBeNull();
    expect(s.lp[1]).toBe(2000);
  });
  it('罠のおまけ能力（お酒の問い）も出る', () => {
    const s = setup(mkTrap('飲', 'attack', 'negateAttack', ab('damage', { cond: 'sake', condN: 100 })));
    s.field[0][0] = mk('攻', 2000);
    s.field[1][0] = mk('守', 500);
    attack(s, 0, 0);
    expect(s.prompts[0].owner).toBe(1);
  });
});

describe('CPU 同士で最後まで遊べる', () => {
  it('200 試合、すべて決着し、問いも答えられて止まらない', () => {
    let ends = 0;
    for (let g = 0; g < 200; g++) {
      const mkDeck = (k: number) => ({ name: `P${k}`, cards: Array.from({ length: 10 }, (_, i) => randomCard(g * 100 + k * 10 + i, `c${i}`)) });
      const s = newGame([mkDeck(0), mkDeck(1)], g + 1);
      let guard = 0;
      while (s.winner === null && guard++ < 4000) if (!(cpuAct(s, 0) || cpuAct(s, 1))) break;
      expect(guard).toBeLessThan(4000);
      if (s.winner !== null) ends++;
    }
    expect(ends).toBe(200);
  });
});
