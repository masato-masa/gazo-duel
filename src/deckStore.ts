// 分析し終えたデッキの保存。画像そのものは端末の外へ出さないまま、
// 小さなサムネイル（約 200px の JPEG）とカードの中身だけを localStorage に残す。
import type { Card } from './game/types';

const KEY = 'gazo-duel:decks:v1';
const MAX_DECKS = 6;

export interface SavedDeck {
  id: string;
  name: string;
  savedAt: number;
  cards: Card[];
}

function read(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedDeck[]) : [];
  } catch {
    return [];
  }
}

function write(decks: SavedDeck[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
    return true;
  } catch {
    return false; // 容量が足りないなど。保存できなくても対戦は続けられる
  }
}

export const listDecks = (): SavedDeck[] => read();

export function saveDeck(name: string, cards: Card[]): void {
  const decks = [{ id: `d${Date.now()}`, name, savedAt: Date.now(), cards }, ...read()].slice(0, MAX_DECKS);
  // 容量オーバーなら古いものから減らして入れ直す
  while (decks.length && !write(decks)) decks.pop();
}

export function removeDeck(id: string): void {
  write(read().filter((d) => d.id !== id));
}

/** 画像の URL から、長辺 200px のサムネイル（data URL）を作る */
export async function thumbnail(url: string, size = 200): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
