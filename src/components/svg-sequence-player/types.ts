export type RotatedRect = [number, number, number, number, number];

export type OcrWordRaw = {
  text: string;
  rotated_rect: RotatedRect;
};

export type OcrJson = {
  code: number;
  data: {
    width: number;
    height: number;
    words: OcrWordRaw[];
  };
};

export type TtsToken = {
  text: string;
  begin_time: number;
  end_time: number;
  begin_index?: number;
  end_index?: number;
};

export type TtsJson = {
  header: Record<string, unknown>;
  payload: {
    subtitles: TtsToken[];
  };
};

export type ManifestSegment = {
  id: string;
  image: string;
  audio: string;
  ocr: string;
  tts: string;
  global_time_range_ms: [number, number];
  duration_ms: number;
  word_index_range: [number, number];
  text: string;
};

export type SegmentManifest = {
  dataset: string;
  image: string;
  source: {
    image: string;
    audio: string;
    ocr: string;
    tts: string;
  };
  segment_count: number;
  segments: ManifestSegment[];
};

export type BBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WordModel = {
  id: string;
  text: string;
  idx: number;
  bbox: BBox;
  t0?: number;
  t1?: number;
};

export type RunModel = {
  id: string;
  bbox: BBox;
  words: WordModel[];
};

export type SegmentModel = {
  id: string;
  audioUrl: string;
  text: string;
  t0: number;
  t1: number;
  runs: RunModel[];
};

export type SegmentAsset = {
  id: string;
  audioUrl: string;
  ocrUrl: string;
  ttsUrl: string;
  text: string;
};

export type PlayerState = "loading" | "idle" | "playing" | "paused" | "error";

export type SvgSequencePlayerExpose = {
  playAll: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  togglePause: () => void;
  stop: () => void;
  getState: () => PlayerState;
};
