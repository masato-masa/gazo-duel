import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { cpuAct } from './game/ai';
import { cardEffectText, cardFromEmbedding, hashStr, randomCard } from './game/cardgen';
import { answerPrompt, attack, canAttack, canSummon, endTurn, newGame, summon } from './game/engine';
import { fieldCards } from './game/ops';
import type { Card, P, State } from './game/types';
import { embedImage, loadClip } from './clip';
import './App.css';

type Seat = { name: string; kind: 'images' | 'random' | 'cpu'; files: File[] };

const DECK = 10;

function artStyle(c: Card): React.CSSProperties {
  if (c.img) return { backgroundImage: `url(${c.img})` };
  const h = hashStr(c.name) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 60) % 360} 70% 30%))` };
}

function CardView({ c, small, mark, onClick }: { c: Card; small?: boolean; mark?: string; onClick?: () => void }) {
  return (
    <button type="button" className={`card${small ? ' small' : ''}${mark ? ` ${mark}` : ''}`} onClick={onClick}>
      <div className="art" style={artStyle(c)}>
        {!c.img && <span className="artword">{c.words[0]}</span>}
      </div>
      <div className="cname">{c.name}</div>
      <div className="cpow">{c.power}</div>
    </button>
  );
}

function Setup({ onStart }: { onStart: (seats: [Seat, Seat]) => void }) {
  const [seats, setSeats] = useState<[Seat, Seat]>([
    { name: 'プレイヤー1', kind: 'images', files: [] },
    { name: 'プレイヤー2', kind: 'images', files: [] },
  ]);
  const set = (i: 0 | 1, patch: Partial<Seat>) =>
    setSeats((s) => (i === 0 ? [{ ...s[0], ...patch }, s[1]] : [s[0], { ...s[1], ...patch }]));
  const ready = seats.every((s) => s.kind !== 'images' || s.files.length === DECK);

  return (
    <div className="setup">
      <h1>ガゾデュエル</h1>
      <p className="lead">画像を 10 枚入れると、その画像に似た言葉からカードができます。飲みながら遊ぶ冗談カードバトル。</p>
      <p className="note">画像はこの端末の中だけで分析します。どこにも送りません。初回だけ分析用のモデル（約 90MB）を読み込みます。</p>
      {([0, 1] as const).map((i) => (
        <section key={i} className="seat">
          <input value={seats[i].name} onChange={(e) => set(i, { name: e.target.value })} aria-label="名前" />
          <div className="kinds">
            <label>
              <input type="radio" checked={seats[i].kind === 'images'} onChange={() => set(i, { kind: 'images' })} /> 画像 10 枚
            </label>
            <label>
              <input type="radio" checked={seats[i].kind === 'random'} onChange={() => set(i, { kind: 'random' })} /> お試し（画像なし）
            </label>
            {i === 1 && (
              <label>
                <input type="radio" checked={seats[i].kind === 'cpu'} onChange={() => set(i, { kind: 'cpu', name: 'CPU' })} /> CPU と対戦
              </label>
            )}
          </div>
          {seats[i].kind === 'images' && (
            <label className="file">
              画像を選ぶ（{seats[i].files.length} / {DECK}）
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => set(i, { files: Array.from(e.target.files ?? []).slice(0, DECK) })}
              />
            </label>
          )}
        </section>
      ))}
      <button type="button" className="big" disabled={!ready} onClick={() => onStart(seats)}>
        はじめる
      </button>
      {!ready && <p className="note">画像を選ぶ人は、ちょうど 10 枚が要ります。</p>}
    </div>
  );
}

function Loading({ text, ratio }: { text: string; ratio: number }) {
  return (
    <div className="loading">
      <div className="spin" />
      <p>{text}</p>
      <div className="bar"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
    </div>
  );
}

async function buildDeck(seat: Seat, k: number, seed: number, onStep: (done: number) => void): Promise<Card[]> {
  if (seat.kind !== 'images') return Array.from({ length: DECK }, (_, i) => randomCard(seed * 31 + k * 97 + i, `${k}-${i}`));
  const cards: Card[] = [];
  for (let i = 0; i < seat.files.length; i++) {
    const url = URL.createObjectURL(seat.files[i]);
    cards.push(cardFromEmbedding(await embedImage(url), url, `${k}-${i}`));
    onStep(i + 1);
  }
  return cards;
}

function Duel({ initial, vsCpu, onExit }: { initial: State; vsCpu: boolean; onExit: () => void }) {
  const ref = useRef<State>(initial);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const s = ref.current;
  const [sel, setSel] = useState<{ kind: 'hand' | 'field'; i: number } | null>(null);
  const [look, setLook] = useState<Card | null>(null);
  const [curtain, setCurtain] = useState(!vsCpu);
  const lastTurn = useRef<P>(s.turn);
  const me: P = vsCpu ? 0 : s.turn;
  const you: P = me === 0 ? 1 : 0;

  const act = useCallback((fn: (st: State) => unknown) => {
    fn(ref.current);
    bump();
  }, []);

  // ターンが替わったら、ホットシートでは端末を渡す幕を出す
  useEffect(() => {
    if (!vsCpu && s.turn !== lastTurn.current && s.winner === null) {
      lastTurn.current = s.turn;
      setCurtain(true);
      setSel(null);
      setLook(null);
    }
  });

  // CPU は 1 手ごとに間を置く
  useEffect(() => {
    if (!vsCpu || s.winner !== null) return;
    const cpuTurn = s.turn === 1 && s.prompts.length === 0;
    const cpuPrompt = s.prompts.length > 0 && s.prompts[0].owner === 1;
    if (!cpuTurn && !cpuPrompt) return;
    const t = setTimeout(() => act((st) => cpuAct(st, 1)), 900);
    return () => clearTimeout(t);
  });

  const prompt = s.prompts[0];
  const humanPrompt = prompt && !(vsCpu && prompt.owner === 1);
  const foeEmpty = fieldCards(s, you).length === 0;
  const myTurn = s.turn === me;

  const clickSlot = (p: P, slot: number) => {
    const c = s.field[p][slot];
    if (c) setLook(c);
    if (p === me) {
      if (sel?.kind === 'hand') {
        act((st) => summon(st, sel.i, slot));
        setSel(null);
      } else if (c && myTurn && canAttack(s, slot)) setSel({ kind: 'field', i: slot });
      else setSel(null);
    } else if (sel?.kind === 'field' && c && myTurn) {
      act((st) => attack(st, sel.i, slot));
      setSel(null);
    }
  };

  const hand = s.hand[me];
  const recent = s.log.slice(-3);

  return (
    <div className="duel">
      <div className="foe-info">
        <b>{s.names[you]}</b>
        <span className="lp">LP {s.lp[you]}</span>
        <span>手札 {s.hand[you].length}</span>
        <span>山 {s.deck[you].length}</span>
        <span>🍺 {s.drinks[you]}</span>
      </div>
      <div className="row field foe-field">
        {s.field[you].map((c, i) => (
          <div key={i} className="slot" onClick={() => clickSlot(you, i)}>
            {c && <CardView c={c} mark={sel?.kind === 'field' ? 'target' : ''} />}
          </div>
        ))}
      </div>
      <div className="mid">
        <div className="logbox">{recent.map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className="btns">
          {sel?.kind === 'field' && foeEmpty && myTurn && (
            <button type="button" className="atk" onClick={() => { act((st) => attack(st, sel.i, 'direct')); setSel(null); }}>
              直接攻撃！
            </button>
          )}
          <button type="button" disabled={!myTurn || s.prompts.length > 0 || s.winner !== null} onClick={() => { act(endTurn); setSel(null); }}>
            ターン終了
          </button>
        </div>
      </div>
      <div className="row field mine">
        {s.field[me].map((c, i) => (
          <div key={i} className={`slot${sel?.kind === 'hand' ? ' drop' : ''}`} onClick={() => clickSlot(me, i)}>
            {c && <CardView c={c} mark={sel?.kind === 'field' && sel.i === i ? 'sel' : s.attacked.includes(c.id) ? 'done' : ''} />}
          </div>
        ))}
      </div>
      <div className="myinfo">
        <b>{s.names[me]}</b>
        <span className="lp">LP {s.lp[me]}</span>
        <span>山 {s.deck[me].length}</span>
        <span>🍺 {s.drinks[me]}</span>
        <span>{myTurn ? (canSummon(s) ? 'カードを出せる' : '') : 'あいてのターン'}</span>
      </div>
      <div className="hand">
        {hand.map((c, i) => (
          <CardView
            key={c.id}
            c={c}
            small
            mark={sel?.kind === 'hand' && sel.i === i ? 'sel' : ''}
            onClick={() => {
              setLook(c);
              setSel(myTurn && canSummon(s) ? (sel?.kind === 'hand' && sel.i === i ? null : { kind: 'hand', i }) : null);
            }}
          />
        ))}
      </div>
      {look && (
        <div className="look" onClick={() => setLook(null)}>
          <b>{look.name}</b>（戦闘力 {look.power}）<br />
          出したとき：{cardEffectText(look)}
        </div>
      )}
      {humanPrompt && (
        <div className="modal">
          <div className="dialog">
            <p>{prompt.text}</p>
            {prompt.choices.map((ch, i) => (
              <button type="button" key={i} onClick={() => act((st) => answerPrompt(st, i))}>{ch.label}</button>
            ))}
          </div>
        </div>
      )}
      {curtain && s.winner === null && (
        <div className="modal curtain">
          <div className="dialog">
            <p>{s.names[s.turn]} の番です</p>
            <p className="note">端末を渡してください。相手に手札を見せないように。</p>
            <button type="button" className="big" onClick={() => setCurtain(false)}>手札を見る</button>
          </div>
        </div>
      )}
      {s.winner !== null && (
        <div className="modal">
          <div className="dialog">
            <h2>{s.winner === 'draw' ? '引き分け' : `${s.names[s.winner]} の勝ち！`}</h2>
            <p>のんだ口数　{s.names[0]} {s.drinks[0]} ／ {s.names[1]} {s.drinks[1]}</p>
            <button type="button" className="big" onClick={onExit}>もう一度</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<'setup' | 'loading' | 'duel'>('setup');
  const [game, setGame] = useState<{ state: State; vsCpu: boolean } | null>(null);
  const [load, setLoad] = useState({ text: '', ratio: 0 });
  const [error, setError] = useState('');

  const start = async (seats: [Seat, Seat]) => {
    setError('');
    setScreen('loading');
    try {
      const seed = Math.floor(Math.random() * 1e9);
      const needs = seats.some((s) => s.kind === 'images');
      if (needs) {
        setLoad({ text: '分析用のモデルを読み込み中…（初回だけ時間がかかります）', ratio: 0 });
        await loadClip((r) => setLoad({ text: '分析用のモデルを読み込み中…（初回だけ時間がかかります）', ratio: r }));
      }
      const decks: Card[][] = [];
      for (let k = 0; k < 2; k++) {
        decks.push(
          await buildDeck(seats[k], k, seed, (d) => setLoad({ text: `${seats[k].name} の画像を分析中 ${d} / ${DECK}`, ratio: d / DECK })),
        );
      }
      const state = newGame(
        [{ name: seats[0].name, cards: decks[0] }, { name: seats[1].name, cards: decks[1] }],
        seed,
      );
      setGame({ state, vsCpu: seats[1].kind === 'cpu' });
      setScreen('duel');
    } catch (e) {
      setError(`うまくいきませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setScreen('setup');
    }
  };

  if (screen === 'loading') return <Loading {...load} />;
  if (screen === 'duel' && game) return <Duel initial={game.state} vsCpu={game.vsCpu} onExit={() => setScreen('setup')} />;
  return (
    <>
      <Setup onStart={start} />
      {error && <p className="error">{error}</p>}
    </>
  );
}

