import { useEffect, useRef, useState } from 'react';
import type { GameEvent, P, Snap, State } from '../game/types';
import { buzz, sfx } from './sound';

export interface Float {
  key: number;
  p: P;
  text: string;
  tone: 'damage' | 'heal' | 'info' | 'drink';
}
export interface Ghost {
  key: number;
  p: P;
  slot: number;
  card: Snap;
}
export interface Fx {
  floats: Float[];
  ghosts: Ghost[];
  lunges: string[];
  rings: { key: number; p: P; slot: number; trap: boolean }[];
  banner: { key: number; name: string; text: string; p: P } | null;
  trap: { key: number; text: string; card: Snap; p: P } | null;
  shake: number;
  flash: { key: number; p: P; tone: 'damage' | 'heal' } | null;
}

const EMPTY: Fx = { floats: [], ghosts: [], lunges: [], rings: [], banner: null, trap: null, shake: 0, flash: null };

/** ゲームの出来事（s.events）を、画面の演出と効果音に変える。状態は変えない */
export function useFx(s: State, tick: number): Fx {
  const [fx, setFx] = useState<Fx>(EMPTY);
  const last = useRef(s.eventSeq);
  const key = useRef(0);

  useEffect(() => {
    const fresh = s.events.filter((e) => e.id > last.current);
    if (!fresh.length) return;
    last.current = s.eventSeq;
    const later = (ms: number, fn: (f: Fx) => Fx) => setTimeout(() => setFx((f) => fn(f)), ms);
    const dropFloat = (k: number, ms: number) => later(ms, (f) => ({ ...f, floats: f.floats.filter((x) => x.key !== k) }));
    const add = (e: GameEvent) => {
      const k = ++key.current;
      switch (e.t) {
        case 'damage':
          sfx('damage');
          if (e.n >= 800) buzz(60);
          setFx((f) => ({
            ...f,
            floats: [...f.floats, { key: k, p: e.p, text: `-${e.n}`, tone: 'damage' }],
            shake: e.n >= 600 ? k : f.shake,
            flash: { key: k, p: e.p, tone: 'damage' },
          }));
          dropFloat(k, 1500);
          if (e.n >= 600) later(480, (f) => (f.shake === k ? { ...f, shake: 0 } : f));
          break;
        case 'heal':
          sfx('heal');
          setFx((f) => ({
            ...f,
            floats: [...f.floats, { key: k, p: e.p, text: `+${e.n}`, tone: 'heal' }],
            flash: { key: k, p: e.p, tone: 'heal' },
          }));
          dropFloat(k, 1500);
          break;
        case 'summon':
          sfx('summon');
          setFx((f) => ({ ...f, rings: [...f.rings, { key: k, p: e.p, slot: e.slot, trap: false }] }));
          later(800, (f) => ({ ...f, rings: f.rings.filter((x) => x.key !== k) }));
          break;
        case 'trapSet':
          sfx('tap');
          setFx((f) => ({ ...f, rings: [...f.rings, { key: k, p: e.p, slot: e.slot, trap: true }] }));
          later(800, (f) => ({ ...f, rings: f.rings.filter((x) => x.key !== k) }));
          break;
        case 'attack': {
          sfx('attack');
          const id = `${e.p}-${e.slot}`;
          setFx((f) => ({ ...f, lunges: [...f.lunges, id] }));
          later(520, (f) => {
            const i = f.lunges.indexOf(id);
            return i < 0 ? f : { ...f, lunges: [...f.lunges.slice(0, i), ...f.lunges.slice(i + 1)] };
          });
          break;
        }
        case 'destroy':
          sfx('destroy');
          setFx((f) => ({ ...f, ghosts: [...f.ghosts, { key: k, p: e.p, slot: e.slot, card: e.card }] }));
          later(1000, (f) => ({ ...f, ghosts: f.ghosts.filter((x) => x.key !== k) }));
          break;
        case 'trap':
          sfx('trap');
          buzz(80);
          setFx((f) => ({ ...f, trap: { key: k, text: e.text, card: e.card, p: e.p } }));
          later(2000, (f) => (f.trap?.key === k ? { ...f, trap: null } : f));
          break;
        case 'ability':
          sfx('ability');
          setFx((f) => ({ ...f, banner: { key: k, name: e.name, text: e.text, p: e.p } }));
          later(2600, (f) => (f.banner?.key === k ? { ...f, banner: null } : f));
          break;
        case 'drink':
          sfx('drink');
          setFx((f) => ({ ...f, floats: [...f.floats, { key: k, p: e.p, text: `🍺×${e.n}`, tone: 'drink' }] }));
          dropFloat(k, 1600);
          break;
        case 'popup':
          setFx((f) => ({ ...f, floats: [...f.floats, { key: k, p: e.p, text: e.text, tone: 'info' }] }));
          dropFloat(k, 1500);
          break;
      }
    };
    fresh.forEach(add);
  }, [s, tick]);

  return fx;
}
