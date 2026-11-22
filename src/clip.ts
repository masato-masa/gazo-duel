import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import data from './data/words.json';

type Loaded = { processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>; model: CLIPVisionModelWithProjection };
let loading: Promise<Loaded> | null = null;

/** 画像側のモデルを読み込む（初回だけ通信。ブラウザに保存されるので 2 回目からは速い） */
/** 読み込みの進み具合（先読みと本読みで共有する。比率は戻らない） */
export const clipProgress = { ratio: 0, loadedMB: 0, totalMB: 0, ready: false, started: false };
const listeners = new Set<(r: number) => void>();

/**
 * 先読み: 画像を選んだ時点で呼ぶ（試合を始める前に、モデルを裏で読み込み始める）。失敗しても何もしない（本読みで再試行される）。
 * 端末のストレージが消されにくいよう、保存の永続化も頼む（対応しているブラウザだけ）。
 */
export function prefetchClip(): void {
  if (clipProgress.started) return;
  void navigator.storage?.persist?.().catch(() => undefined);
  void loadClip().catch(() => undefined);
}

export function loadClip(onProgress?: (ratio: number) => void): Promise<Loaded> {
  if (onProgress) {
    listeners.add(onProgress);
    onProgress(clipProgress.ratio);
  }
  if (!loading) {
    clipProgress.started = true;
    loading = (async () => {
      const files = new Map<string, { loaded: number; total: number }>();
      const cb = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          let l = 0;
          let t = 0;
          files.forEach((f) => ((l += f.loaded), (t += f.total)));
          // 新しいファイルが現れると合計が増えて割合が戻るので、戻らないようにする
          clipProgress.loadedMB = l / 1048576;
          clipProgress.totalMB = t / 1048576;
          clipProgress.ratio = Math.max(clipProgress.ratio, t ? l / t : 0);
          listeners.forEach((f) => f(clipProgress.ratio));
        }
      };
      const processor = await AutoProcessor.from_pretrained(data.model, { progress_callback: cb });
      const model = await CLIPVisionModelWithProjection.from_pretrained(data.model, { dtype: 'q8', progress_callback: cb });
      clipProgress.ratio = 1;
      clipProgress.ready = true;
      listeners.forEach((f) => f(1));
      return { processor, model };
    })().catch((e) => {
      loading = null;
      clipProgress.started = false;
      throw e;
    });
  }
  return loading;
}

/** 画像 1 枚を、言葉と比べられる向きのそろった数字の列にする */
export async function embedImage(url: string): Promise<Float32Array> {
  const { processor, model } = await loadClip();
  const img = await RawImage.read(url);
  const inputs = await processor(img);
  const { image_embeds } = await model(inputs);
  const v = Float32Array.from(image_embeds.data as Float32Array);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

const embedCache = new Map<string, Promise<Float32Array>>();
const keyOfFile = (f: File): string => `${f.name}:${f.size}:${f.lastModified}`;

/** ファイル 1 枚の分析（同じファイルは 1 度だけ。先読みの結果を本読みが使い回す） */
export function embedFile(f: File): Promise<Float32Array> {
  const k = keyOfFile(f);
  let p = embedCache.get(k);
  if (!p) {
    const url = URL.createObjectURL(f);
    p = embedImage(url).finally(() => URL.revokeObjectURL(url));
    p.catch(() => embedCache.delete(k));
    embedCache.set(k, p);
  }
  return p;
}

/**
 * 画像を選んだ直後に、モデルの準備ができたら 1 枚ずつ分析しておく（画面が固まらないよう、1 枚ごとに少し間をあける）。
 * 試合を始めるときには、ほとんど済んでいる。
 */
export async function prefetchEmbeddings(files: File[]): Promise<void> {
  try {
    await loadClip();
    for (const f of files) {
      await embedFile(f);
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch {
    /* 本読みで改めて分析される */
  }
}
