import { cardEffectText, hashStr, nounOf } from '../game/cardgen';
import type { Card, Snap } from '../game/types';

type Faceable = Pick<Card, 'name' | 'img' | 'kind' | 'words' | 'hue'>;

/** 画像があればそれ、無ければ言葉と色から描いた絵 */
export function Art({ c }: { c: Faceable | Snap }) {
  if (c.img) return <img className="art-img" src={c.img} alt="" draggable={false} />;
  const h = c.hue;
  const seed = hashStr(c.name);
  const r = (i: number) => ((Math.imul(seed ^ (i * 2654435761), 2246822519) >>> 0) % 1000) / 1000;
  const glyph = nounOf(c.words[0] ?? '').slice(0, 3);
  const shapes = Array.from({ length: 6 }, (_, i) => ({
    x: 10 + r(i) * 80,
    y: 10 + r(i + 9) * 80,
    rad: 10 + r(i + 17) * 28,
    o: 0.12 + r(i + 25) * 0.25,
    hue: (h + 30 + r(i + 33) * 90) % 360,
  }));
  const trap = c.kind === 'trap';
  return (
    <svg className="art-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`g${seed}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 75% ${trap ? 32 : 52}%)`} />
          <stop offset="1" stopColor={`hsl(${(h + 70) % 360} 70% ${trap ? 18 : 26}%)`} />
        </linearGradient>
        <pattern id={`p${seed}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="8" fill="#fff" opacity="0.06" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill={`url(#g${seed})`} />
      {shapes.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.rad} fill={`hsl(${s.hue} 80% 65%)`} opacity={s.o} />
      ))}
      <rect width="100" height="100" fill={`url(#p${seed})`} />
      <circle cx="50" cy="50" r="34" fill={`hsl(${h} 90% 75%)`} opacity="0.22" />
      <circle cx="50" cy="50" r="24" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 3" />
      {shapes.slice(0, 3).map((s, i) => (
        <path key={`s${i}`} d={`M${s.x} ${s.y - 5}L${s.x + 1.5} ${s.y - 1.5}L${s.x + 5} ${s.y}L${s.x + 1.5} ${s.y + 1.5}L${s.x} ${s.y + 5}L${s.x - 1.5} ${s.y + 1.5}L${s.x - 5} ${s.y}L${s.x - 1.5} ${s.y - 1.5}Z`} fill="#fff" opacity="0.7" />
      ))}
      <text x="50" y="58" textAnchor="middle" fontSize={glyph.length > 2 ? 24 : 32} textLength={Math.min(84, glyph.length * 30)} lengthAdjust="spacingAndGlyphs" fontWeight="800" fill="#fff" stroke="#0006" strokeWidth="1.2" paintOrder="stroke" fontFamily="sans-serif">
        {glyph}
      </text>
    </svg>
  );
}

const tier = (p: number): string => (p >= 1500 ? 'hi' : p <= 300 ? 'lo' : '');

/** 場に出ているカード（枠いっぱい） */
export function FieldCard({ c, mark, className = '' }: { c: Card; mark?: string; className?: string }) {
  return (
    <div className={`fcard ${c.kind} ${mark ?? ''} ${tier(c.power)} ${className}`}>
      <Art c={c} />
      <div className="fname">{c.name}</div>
      <div className="fpow">{c.power}</div>
      {c.power >= 1500 && <div className="holo" />}
    </div>
  );
}

/** 手札・詳細のカード。効果の文章まで載せる */
export function FullCard({ c, big, selected, onClick }: { c: Card; big?: boolean; selected?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`full ${c.kind}${big ? ' big' : ''}${selected ? ' sel' : ''} ${tier(c.base)}`} onClick={onClick}>
      <div className="fhead">
        <span className="fn">{c.name}</span>
        {c.kind === 'trap' && <span className="trapmark">罠</span>}
      </div>
      <div className="fart">
        <Art c={c} />
        {c.kind === 'monster' && <div className="powbadge">{c.power}</div>}
      </div>
      <div className="ftext">{cardEffectText(c)}</div>
      {c.base >= 1500 && c.kind === 'monster' && <div className="holo" />}
    </button>
  );
}

/** 相手の伏せカード・自分の伏せカード（自分には名前が見える） */
export function TrapBack({ c, mine }: { c: Card | null; mine: boolean }) {
  if (!c) return null;
  return (
    <div className={`trapback${mine ? ' mine' : ''}`}>
      <span>{mine ? c.name : '？'}</span>
    </div>
  );
}
