import { useLayoutEffect, useRef, useState } from 'react';
import iconTrap from '../assets/icon-trap.png';
import { cardEffectText, hashStr, nounOf } from '../game/cardgen';
import type { Card, Snap } from '../game/types';

type Faceable = Pick<Card, 'name' | 'img' | 'kind' | 'words' | 'hue'>;

/**
 * 画像があればそれ、無ければ言葉と色から描いた絵。
 * 絵は div 1 個の CSS 背景（グラデーションの重ね）と、::after の大きな文字だけで作る（以前は SVG で約 25 個の要素だった）。
 */
export function Art({ c }: { c: Faceable | Snap }) {
  if (c.img) return <img className="art-img" src={c.img} alt="" draggable={false} />;
  const h = c.hue;
  const seed = hashStr(c.name);
  const r = (i: number) => ((Math.imul(seed ^ (i * 2654435761), 2246822519) >>> 0) % 1000) / 1000;
  const glyph = nounOf(c.words[0] ?? '').slice(0, 3);
  const trap = c.kind === 'trap';
  const dots = Array.from({ length: 6 }, (_, i) => {
    const x = 10 + r(i) * 80;
    const y = 10 + r(i + 9) * 80;
    const rad = 10 + r(i + 17) * 28;
    const o = 0.12 + r(i + 25) * 0.25;
    const hue = (h + 30 + r(i + 33) * 90) % 360;
    return `radial-gradient(circle at ${x.toFixed(0)}% ${y.toFixed(0)}%, hsl(${hue.toFixed(0)} 80% 65% / ${o.toFixed(2)}) ${rad.toFixed(0)}%, transparent ${(rad + 0.5).toFixed(1)}%)`;
  });
  const background = [
    `radial-gradient(circle at 50% 50%, hsl(${h} 90% 75% / 0.22) 34%, transparent 34.5%)`,
    ...dots,
    'repeating-linear-gradient(45deg, #ffffff10 0 3px, transparent 3px 8px)',
    `linear-gradient(135deg, hsl(${h} 75% ${trap ? 32 : 52}%), hsl(${(h + 70) % 360} 70% ${trap ? 18 : 26}%))`,
  ].join(',');
  return <div className={`art-gen${glyph.length > 2 ? ' long' : ''}`} data-g={glyph} style={{ background }} aria-hidden />;
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
  const tx = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const e = tx.current;
    if (e) setCut(e.scrollHeight > e.clientHeight + 1);
  }, [c]);
  return (
    <button type="button" className={`full ${c.kind}${big ? ' big' : ''}${selected ? ' sel' : ''} ${tier(c.base)}`} onClick={onClick}>
      <div className="fhead">
        <span className="fn">{c.name}</span>
        {c.kind === 'trap' && <span className="trapmark"><img src={iconTrap} alt="罠" /></span>}
      </div>
      <div className="fart">
        <Art c={c} />
        {c.kind === 'monster' && <div className="powbadge">{c.power}</div>}
      </div>
      <div ref={tx} className={`ftext${cut ? ' cut' : ''}`}>{cardEffectText(c)}</div>
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

/** カードを拡大して全文を出す。小さい手札・説明欄で読み切れない罠の長い文のため。どこをタップしても閉じる。 */
export function CardZoom({ c, onClose }: { c: Card; onClose: () => void }) {
  return (
    <div className="zoom" role="dialog" aria-label={`${c.name}の詳細`} onClick={onClose}>
      <div className={`zoomcard ${c.kind} ${tier(c.base)}`}>
        <div className="zhead">
          <span className="zname">{c.name}</span>
          {c.kind === 'trap' ? <span className="trapmark"><img src={iconTrap} alt="罠" /></span> : <span className="zpow">{c.power}</span>}
        </div>
        <div className="zart">
          <Art c={c} />
        </div>
        <div className="ztext">{cardEffectText(c)}</div>
        <div className="zwords">近かった言葉：{c.words.map(nounOf).join('・')}</div>
        <div className="zclose">タップで閉じる</div>
      </div>
    </div>
  );
}
