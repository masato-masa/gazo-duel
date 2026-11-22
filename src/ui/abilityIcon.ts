import fire from '../assets/ab-fire.png';
import heart from '../assets/ab-heart.png';
import up from '../assets/ab-up.png';
import down from '../assets/ab-down.png';
import cards from '../assets/ab-cards.png';
import wand from '../assets/ab-wand.png';
import beer from '../assets/icon-beer.png';

/** 能力の動作 → アイコン（6 分類 + お酒）。能力の種類が 1 目で分かるようにするため。 */
const BY_ACTION: Record<string, string> = {
  damage: fire, poison: fire, destroy: fire, mirror: fire,
  heal: heart, regen: heart, immortal: heart,
  powerUp: up, extraSummon: up, revive: up,
  powerDown: down, halve: down, seal: down, skipDraw: down,
  draw: cards, discard: cards, mill: cards, swapHands: cards, steal: cards, gift: cards, returnCard: cards,
  drinkFoe: beer, kanpai: beer,
};

export const abilityIcon = (action: string | undefined): string => (action && BY_ACTION[action]) || wand;
