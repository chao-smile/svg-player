import type { BBox, OcrJson, RunModel, SegmentAsset, SegmentModel, TtsJson, WordModel } from "./types";

function unionBBox(words: WordModel[]): BBox {
  const x0 = Math.min(...words.map((w) => w.bbox.x));
  const y0 = Math.min(...words.map((w) => w.bbox.y));
  const x1 = Math.max(...words.map((w) => w.bbox.x + w.bbox.w));
  const y1 = Math.max(...words.map((w) => w.bbox.y + w.bbox.h));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

export function expandBox(box: BBox): BBox {
  const padX = Math.max(1, Math.round(box.h * 0.06));
  const topExpand = Math.max(1, Math.round(box.h * 0.1));
  const bottomExpand = Math.max(2, Math.round(box.h * 0.18));
  return {
    x: box.x - padX,
    y: box.y - topExpand,
    w: Math.max(1, box.w + padX * 2),
    h: Math.max(1, box.h + topExpand + bottomExpand),
  };
}

function clusterRuns(words: WordModel[], imageWidth: number): WordModel[][] {
  const left = words.filter((w) => w.bbox.x < imageWidth * 0.55);
  const right = words.filter((w) => w.bbox.x >= imageWidth * 0.55);

  const makeLines = (input: WordModel[]) => {
    const sorted = [...input].sort(
      (a, b) => a.bbox.y + a.bbox.h / 2 - (b.bbox.y + b.bbox.h / 2) || a.bbox.x - b.bbox.x,
    );

    const lines: WordModel[][] = [];
    for (const word of sorted) {
      const cy = word.bbox.y + word.bbox.h / 2;
      let placed = false;
      for (const line of lines) {
        const head = line[0];
        if (!head) continue;
        const ly = head.bbox.y + head.bbox.h / 2;
        if (Math.abs(cy - ly) <= Math.max(10, head.bbox.h * 0.6)) {
          line.push(word);
          placed = true;
          break;
        }
      }
      if (!placed) lines.push([word]);
    }

    for (const line of lines) line.sort((a, b) => a.bbox.x - b.bbox.x);
    return lines;
  };

  const all = [...makeLines(left), ...makeLines(right)].filter((line) => line.length > 0);
  all.sort((a, b) => a[0]!.bbox.y - b[0]!.bbox.y || a[0]!.bbox.x - b[0]!.bbox.x);
  return all;
}

function buildWords(ocr: OcrJson): WordModel[] {
  return ocr.data.words.map((word, idx) => {
    const [x, y, w, h] = word.rotated_rect;
    // Backend ocr points are center-based.
    return {
      id: `word-${idx}`,
      idx,
      text: word.text,
      bbox: { x: x - w / 2, y: y - h / 2, w, h },
    };
  });
}

function attachTokenTiming(words: WordModel[], tts: TtsJson) {
  const subs = tts.payload?.subtitles ?? [];
  for (const token of subs) {
    const idx = token.begin_index;
    if (typeof idx !== "number" || idx < 0 || idx >= words.length) continue;
    const word = words[idx];
    if (!word) continue;
    word.t0 = typeof word.t0 === "number" ? Math.min(word.t0, token.begin_time) : token.begin_time;
    word.t1 = typeof word.t1 === "number" ? Math.max(word.t1, token.end_time) : token.end_time;
  }
}

function timeRange(words: WordModel[]) {
  const timed = words.filter((w): w is WordModel & { t0: number; t1: number } => typeof w.t0 === "number" && typeof w.t1 === "number");
  if (!timed.length) return { t0: 0, t1: 0 };
  return {
    t0: Math.min(...timed.map((w) => w.t0)),
    t1: Math.max(...timed.map((w) => w.t1)),
  };
}

export async function loadSegmentModels(segmentAssets: SegmentAsset[]): Promise<{ imageWidth: number; imageHeight: number; segments: SegmentModel[] }> {
  const loaded = await Promise.all(
    segmentAssets.map(async (asset) => {
      const [ocr, tts] = await Promise.all([
        fetch(asset.ocrUrl, { cache: "no-store" }).then((r) => r.json() as Promise<OcrJson>),
        fetch(asset.ttsUrl, { cache: "no-store" }).then((r) => r.json() as Promise<TtsJson>),
      ]);

      const words = buildWords(ocr);
      attachTokenTiming(words, tts);

      const runs: RunModel[] = clusterRuns(words, ocr.data.width).map((line, i) => ({
        id: `${asset.id}-run-${i + 1}`,
        bbox: unionBBox(line),
        words: line,
      }));

      const range = timeRange(words);
      const segment: SegmentModel = {
        id: asset.id,
        audioUrl: asset.audioUrl,
        text: asset.text,
        t0: range.t0,
        t1: range.t1,
        runs,
      };

      return { segment, imageWidth: ocr.data.width, imageHeight: ocr.data.height };
    }),
  );

  return {
    imageWidth: loaded[0]?.imageWidth ?? 0,
    imageHeight: loaded[0]?.imageHeight ?? 0,
    segments: loaded.map((item) => item.segment),
  };
}

export function computeRunProgress(run: RunModel, tMs: number): number {
  const timed = run.words
    .filter((w): w is WordModel & { t0: number; t1: number } => typeof w.t0 === "number" && typeof w.t1 === "number")
    .sort((a, b) => a.t0 - b.t0);

  if (!timed.length) return 0;
  if (tMs <= timed[0]!.t0) return 0;
  if (tMs >= timed[timed.length - 1]!.t1) return 1;

  let xFill = run.bbox.x;
  for (let i = 0; i < timed.length; i++) {
    const cur = timed[i]!;
    const next = timed[i + 1];
    const right = cur.bbox.x + cur.bbox.w;

    if (tMs >= cur.t1) {
      xFill = Math.max(xFill, right);
      continue;
    }

    if (tMs >= cur.t0 && tMs < cur.t1) {
      const ratio = Math.max(0, Math.min(1, (tMs - cur.t0) / Math.max(1, cur.t1 - cur.t0)));
      xFill = Math.max(xFill, cur.bbox.x + cur.bbox.w * ratio);
      break;
    }

    if (next && tMs >= cur.t1 && tMs < next.t0) {
      const ratio = Math.max(0, Math.min(1, (tMs - cur.t1) / Math.max(1, next.t0 - cur.t1)));
      const xGap = right + (next.bbox.x - right) * ratio;
      xFill = Math.max(xFill, xGap);
      break;
    }
  }

  return Math.max(0, Math.min(1, (xFill - run.bbox.x) / Math.max(1, run.bbox.w)));
}
