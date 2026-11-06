import { describe, expect, it } from 'vitest';
import { cpuAct } from '../game/ai';
import { randomCard, WORDS } from '../game/cardgen';
import { answerPrompt, attack, endTurn, newGame, summon } from '../game/engine';
import { CARD_PARTS } from '../game/effects';
import type { Card, State } from '../game/types';

const mk = (name: string, power: number, effects: Card['effects'] = []): Card => ({
  id: name, name, power, base: power, effects, img: '', words: [],
});
const deck = (n: number, power = 1000) => Array.from({ length: 10 }, (_, i) => mk(`${n}-${i}`, power));

function game(): State {
  return newGame([{ name: 'A', cards: deck(0) }, { name: 'B', cards: deck(1) }], 1);
}

describe('辞書と部品', () => {
  it('辞書は 500 語以上、効果の部品は 45 個以上', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(500);
    expect(CARD_PARTS.length).toBeGreaterThanOrEqual(45);
  });
  it('同じ種からは同じカードができる', () => {
    expect(randomCard(42, 'x')).toEqual(randomCard(42, 'x'));
  });
  it('カードは名前・3 つの効果・0〜4800 の戦闘力を持つ', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCard(i, 'x');
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.effects).toHaveLength(3);
      expect(new Set(c.effects.map((e) => e.part)).size).toBe(3);
      expect(c.base).toBeGreaterThanOrEqual(0);
      expect(c.base).toBeLessThanOrEqual(4800);
    }
  });
});

describe('対戦の規則', () => {
  it('LP 4000・手札 3 枚で始まり、先攻は最初のターンに引かない', () => {
    const s = game();
    expect(s.lp).toEqual([4000, 4000]);
    expect(s.hand[0]).toHaveLength(3);
    expect(s.hand[1]).toHaveLength(3);
  });
  it('先攻の最初のターンは攻撃できない', () => {
    const s = game();
    summon(s, 0, 0);
    expect(attack(s, 0, 'direct')).toBe(false);
  });
  it('相手の場が空なら直接攻撃、いれば直接はできない', () => {
    const s = game();
    endTurn(s); // B のターン（1 枚引く）
    summon(s, 0, 0);
    endTurn(s);
    s.turnNo = 5;
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
    expect(s.lp).toEqual([4000, 3500]);
  });
  it('負けた攻撃は、攻撃側が差ぶんを受ける', () => {
    const s = game();
    s.turnNo = 5;
    s.field[0][0] = mk('弱', 1000);
    s.field[1][0] = mk('強', 1800);
    attack(s, 0, 0);
    expect(s.field[0][0]).toBeNull();
    expect(s.lp[0]).toBe(3200);
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
  it('デッキが無いのに引くと負け', () => {
    const s = game();
    s.deck[1] = [];
    endTurn(s);
    expect(s.winner).toBe(0);
  });
  it('LP が 0 になると負け', () => {
    const s = game();
    s.turnNo = 5;
    s.lp[1] = 500;
    s.field[0][0] = mk('強', 2000);
    attack(s, 0, 'direct');
    expect(s.winner).toBe(0);
  });
  it('問いが出ている間は何もできない', () => {
    const s = game();
    s.prompts.push({ text: 't', owner: 0, choices: [{ label: 'ok', eff: { part: 'nop', n: 0 }, who: 'owner' }] });
    expect(summon(s, 0, 0)).toBe(false);
    answerPrompt(s, 0);
    expect(summon(s, 0, 0)).toBe(true);
  });
});

describe('どの効果も壊れずに動く', () => {
  it('全部品を、空の場・満杯の場・デッキ空で動かしても例外を出さない', () => {
    for (const part of CARD_PARTS) {
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
        const c = mk('試験', 1500, [{ part: part.id, n: part.range[0] }]);
        s.hand[0].push(c);
        const before = s.hand[0].length;
        expect(() => summon(s, before - 1, 0)).not.toThrow();
        expect(s.lp[0]).toBeGreaterThanOrEqual(0);
        expect(s.lp[1]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('CPU 同士で最後まで遊べる', () => {
  it('100 試合、すべて決着し、問いも答えられて止まらない', () => {
    let ends = 0;
    for (let g = 0; g < 100; g++) {
      const mkDeck = (k: number) => ({ name: `P${k}`, cards: Array.from({ length: 10 }, (_, i) => randomCard(g * 100 + k * 10 + i, `c${i}`)) });
      const s = newGame([mkDeck(0), mkDeck(1)], g + 1);
      let guard = 0;
      while (s.winner === null && guard++ < 3000) {
        const acted = cpuAct(s, 0) || cpuAct(s, 1);
        if (!acted) break;
      }
      expect(guard).toBeLessThan(3000);
      if (s.winner !== null) ends++;
    }
    expect(ends).toBe(100);
  });
});
