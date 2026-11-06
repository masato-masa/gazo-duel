import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { cpuAct } from './game/ai';
import { cardEffectText, cardFromEmbedding, randomCard } from './game/cardgen';
import { answerPrompt, attack, canAttack, canSetTrap, canSummon, endTurn, newGame, setTrap, summon } from './game/engine';
import { fieldCards } from './game/ops';
import type { Card, P, State } from './game/types';
import { embedImage, loadClip } from './clip';
import { Art, FieldCard, FullCard, TrapBack } from './ui/CardView';
import { isMuted, setMuted, sfx } from './ui/sound';
import { useFx } from './ui/useFx';
import './App.css';

type Seat = { name: string; kind: 'images' | 'random' | 'cpu'; files: File[] };

const DECK = 10;

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
      <p className="lead">画像を 10 枚入れると、その画像に似た言葉からモンスターと罠のカードができます。飲みながら遊ぶ冗談カードバトル。</p>
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
              <input type="file" accept="image/*" multiple onChange={(e) => set(i, { files: Array.from(e.target.files ?? []).slice(0, DECK) })} />
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

/** LP の数字を、変化に合わせてなめらかに動かす */
function useTween(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const v = Math.round(a + (value - a) * (1 - (1 - k) ** 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function LpBar({ lp }: { lp: number }) {
  const shown = useTween(lp);
  const ratio = Math.min(1, lp / 4000);
  return (
    <div className={`lpbar${lp <= 1500 ? ' low' : ''}`}>
      <i style={{ width: `${ratio * 100}%` }} />
      <b>{shown}</b>
    </div>
  );
}

function Duel({ initial, vsCpu, onExit }: { initial: State; vsCpu: boolean; onExit: () => void }) {
  const ref = useRef<State>(initial);
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  const s = ref.current;
  const fx = useFx(s, tick);
  const [sel, setSel] = useState<{ kind: 'hand' | 'field'; i: number } | null>(null);
  const [look, setLook] = useState<Card | null>(null);
  const [curtain, setCurtain] = useState(!vsCpu);
  const [muted, setMutedState] = useState(isMuted());
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

  useEffect(() => {
    if (s.winner !== null) sfx('win');
  }, [s.winner]);

  // CPU は 1 手ごとに間を置く
  useEffect(() => {
    if (!vsCpu || s.winner !== null) return;
    const cpuTurn = s.turn === 1 && s.prompts.length === 0;
    const cpuPrompt = s.prompts.length > 0 && s.prompts[0].owner === 1;
    if (!cpuTurn && !cpuPrompt) return;
    const t = setTimeout(() => act((st) => cpuAct(st, 1)), 1000);
    return () => clearTimeout(t);
  });

  const prompt = s.prompts[0];
  const humanPrompt = prompt && !(vsCpu && prompt.owner === 1);
  const foeEmpty = fieldCards(s, you).length === 0;
  const myTurn = s.turn === me;
  const handCard = sel?.kind === 'hand' ? s.hand[me][sel.i] : undefined;

  const clickSlot = (p: P, slot: number) => {
    const c = s.field[p][slot];
    if (c) setLook(c);
    if (p === me) {
      if (handCard?.kind === 'monster') {
        act((st) => summon(st, sel!.i, slot));
        setSel(null);
      } else if (c && myTurn && canAttack(s, slot)) setSel({ kind: 'field', i: slot });
      else setSel(null);
    } else if (sel?.kind === 'field' && c && myTurn) {
      act((st) => attack(st, sel.i, slot));
      setSel(null);
    }
  };

  const clickTrap = (p: P, slot: number) => {
    if (p === me && handCard?.kind === 'trap') {
      act((st) => setTrap(st, sel!.i, slot));
      setSel(null);
      return;
    }
    const c = s.traps[p][slot];
    if (c && p === me) setLook(c);
  };

  const hint = !myTurn
    ? 'あいてのターン'
    : handCard?.kind === 'monster'
      ? '出すマスをタップ'
      : handCard?.kind === 'trap'
        ? '伏せるマスをタップ'
        : sel?.kind === 'field'
          ? foeEmpty ? '「直接攻撃」を押す' : '攻撃する相手をタップ'
          : s.turnNo === 1 ? '手札を選んで出す（最初のターンは攻撃できない）' : '手札を出す／場のカードで攻撃';

  const hand = s.hand[me];
  const slotClass = (p: P, slot: number) => {
    const id = `${p}-${slot}`;
    const up = fx.lunges.includes(id) ? (p === me ? ' lunge-up' : ' lunge-down') : '';
    return `slot${up}${p === me && handCard?.kind === 'monster' ? ' drop' : ''}`;
  };
  const floatsOf = (p: P) => fx.floats.filter((f) => f.p === p);

  return (
    <div className={`duel${fx.shake ? ' shake' : ''}`}>
      <div className="info foe-info">
        <div className="who"><b>{s.names[you]}</b><span>手札 {s.hand[you].length}・山 {s.deck[you].length}・🍺{s.drinks[you]}</span></div>
        <LpBar lp={s.lp[you]} />
        {floatsOf(you).map((f) => <span key={f.key} className={`float ${f.tone}`}>{f.text}</span>)}
      </div>
      <div className="traprow">
        {s.traps[you].map((c, i) => (
          <div key={i} className={`trapslot${fx.rings.some((r) => r.trap && r.p === you && r.slot === i) ? ' ringed' : ''}`} onClick={() => clickTrap(you, i)}>
            <TrapBack c={c} mine={false} />
          </div>
        ))}
      </div>
      <div className="field foe-field">
        {s.field[you].map((c, i) => (
          <div key={i} className={slotClass(you, i)} onClick={() => clickSlot(you, i)}>
            {c && <FieldCard c={c} mark={sel?.kind === 'field' ? 'target' : ''} className="enter" />}
            {fx.ghosts.filter((g) => g.p === you && g.slot === i).map((g) => <Ghost key={g.key} g={g} />)}
            {fx.rings.filter((r) => !r.trap && r.p === you && r.slot === i).map((r) => <i key={r.key} className="ring" />)}
          </div>
        ))}
      </div>
      <div className="mid">
        <div className="hint">{s.turn === me ? `${s.names[me]} のターン` : `${s.names[s.turn]} のターン`}<small>{hint}</small></div>
        <div className="btns">
          {sel?.kind === 'field' && foeEmpty && myTurn && (
            <button type="button" className="atk" onClick={() => { act((st) => attack(st, sel.i, 'direct')); setSel(null); }}>直接攻撃！</button>
          )}
          <button type="button" disabled={!myTurn || s.prompts.length > 0 || s.winner !== null} onClick={() => { act(endTurn); setSel(null); setLook(null); }}>ターン終了</button>
          <button type="button" className="mute" aria-label="音" onClick={() => { setMuted(!muted); setMutedState(!muted); }}>{muted ? '🔇' : '🔊'}</button>
        </div>
      </div>
      <div className="field mine">
        {s.field[me].map((c, i) => (
          <div key={i} className={slotClass(me, i)} onClick={() => clickSlot(me, i)}>
            {c && <FieldCard c={c} className="enter" mark={sel?.kind === 'field' && sel.i === i ? 'sel' : s.attacked.includes(c.id) ? 'done' : ''} />}
            {fx.ghosts.filter((g) => g.p === me && g.slot === i).map((g) => <Ghost key={g.key} g={g} />)}
            {fx.rings.filter((r) => !r.trap && r.p === me && r.slot === i).map((r) => <i key={r.key} className="ring" />)}
          </div>
        ))}
      </div>
      <div className="traprow">
        {s.traps[me].map((c, i) => (
          <div key={i} className={`trapslot${handCard?.kind === 'trap' ? ' drop' : ''}${fx.rings.some((r) => r.trap && r.p === me && r.slot === i) ? ' ringed' : ''}`} onClick={() => clickTrap(me, i)}>
            <TrapBack c={c} mine />
          </div>
        ))}
      </div>
      <div className="info my-info">
        <div className="who"><b>{s.names[me]}</b><span>山 {s.deck[me].length}・🍺{s.drinks[me]}・{myTurn ? (canSummon(s) || canSetTrap(s) ? '出せる' : '') : ''}</span></div>
        <LpBar lp={s.lp[me]} />
        {floatsOf(me).map((f) => <span key={f.key} className={`float ${f.tone}`}>{f.text}</span>)}
      </div>
      <div className="look" onClick={() => setLook(null)}>
        {look ? (
          <>
            <b>{look.name}</b>{look.kind === 'monster' ? `（戦闘力 ${look.power}）` : '（罠）'}<br />
            {cardEffectText(look)}
          </>
        ) : (
          <span className="lookhint">カードをタップすると、効果の説明が出ます</span>
        )}
      </div>
      <div className="hand">
        {hand.map((c, i) => (
          <FullCard
            key={c.id}
            c={c}
            selected={sel?.kind === 'hand' && sel.i === i}
            onClick={() => {
              sfx('tap');
              setLook(c);
              const playable = c.kind === 'monster' ? canSummon(s) : canSetTrap(s);
              setSel(myTurn && playable ? (sel?.kind === 'hand' && sel.i === i ? null : { kind: 'hand', i }) : null);
            }}
          />
        ))}
      </div>

      {fx.flash && <div key={fx.flash.key} className={`flash ${fx.flash.tone} ${fx.flash.p === me ? 'bottom' : 'top'}`} />}
      {fx.banner && (
        <div key={fx.banner.key} className="banner">
          <b>{fx.banner.name}</b>
          <span>{fx.banner.text}</span>
        </div>
      )}
      {fx.trap && (
        <div key={fx.trap.key} className="trapfx">
          <div className="trapcard"><Art c={fx.trap.card} /><span>{fx.trap.card.name}</span></div>
          <h2>罠発動！</h2>
          <p>{fx.trap.text}</p>
        </div>
      )}
      {humanPrompt && (
        <div className="modal">
          <div className="dialog">
            {prompt.pending && <h3>{prompt.pending.cardName}</h3>}
            <p>{prompt.text}</p>
            {prompt.choices.map((ch, i) => (
              <button type="button" key={i} onClick={() => { sfx('tap'); act((st) => answerPrompt(st, i)); }}>{ch.label}</button>
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
        <div className="modal win">
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

/** 壊れたカードの残像。ばらばらに飛び散る */
function Ghost({ g }: { g: { card: Parameters<typeof Art>[0]['c'] } }) {
  const bits = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2 + i;
    return { dx: Math.cos(a) * (40 + (i % 3) * 18), dy: Math.sin(a) * (40 + (i % 4) * 14), d: (i % 5) * 30 };
  });
  return (
    <div className="ghost">
      <div className="ghostcard"><Art c={g.card} /></div>
      {bits.map((b, i) => (
        <i key={i} className="bit" style={{ '--dx': `${b.dx}px`, '--dy': `${b.dy}px`, animationDelay: `${b.d}ms` } as React.CSSProperties} />
      ))}
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
      if (seats.some((s) => s.kind === 'images')) {
        const msg = '分析用のモデルを読み込み中…（初回だけ時間がかかります）';
        setLoad({ text: msg, ratio: 0 });
        await loadClip((r) => setLoad({ text: msg, ratio: r }));
      }
      const decks: Card[][] = [];
      for (let k = 0; k < 2; k++) {
        decks.push(await buildDeck(seats[k], k, seed, (d) => setLoad({ text: `${seats[k].name} の画像を分析中 ${d} / ${DECK}`, ratio: d / DECK })));
      }
      const state = newGame([{ name: seats[0].name, cards: decks[0] }, { name: seats[1].name, cards: decks[1] }], seed);
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
