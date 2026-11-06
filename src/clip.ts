import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import data from './data/words.json';

type Loaded = { processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>; model: CLIPVisionModelWithProjection };
let loading: Promise<Loaded> | null = null;

/** 画像側のモデルを読み込む（初回だけ通信。ブラウザに保存されるので 2 回目からは速い） */
export function loadClip(onProgress?: (ratio: number) => void): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const files = new Map<string, { loaded: number; total: number }>();
      const cb = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          let l = 0;
          let t = 0;
          files.forEach((f) => ((l += f.loaded), (t += f.total)));
          onProgress?.(t ? l / t : 0);
        }
      };
      const processor = await AutoProcessor.from_pretrained(data.model, { progress_callback: cb });
      const model = await CLIPVisionModelWithProjection.from_pretrained(data.model, { dtype: 'q8', progress_callback: cb });
      return { processor, model };
    })().catch((e) => {
      loading = null;
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
