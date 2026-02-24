import type { SegmentAsset, SegmentManifest } from "../components/svg-sequence-player";
import manifestJson from "./svg-player/manifest.json";

const manifest = manifestJson as SegmentManifest;

const toMockUrl = (file: string) => new URL(`./svg-player/${file}`, import.meta.url).href;

export const SVG_PLAYER_DATA_ROOT = "src/mock/svg-player";

export const SVG_PLAYER_MANIFEST: SegmentManifest = manifest;

export const SVG_PLAYER_MANIFEST_URL = toMockUrl("manifest.json");
export const SVG_PLAYER_IMAGE_URL = toMockUrl(SVG_PLAYER_MANIFEST.image);

export const SVG_PLAYER_SEGMENT_ASSETS: SegmentAsset[] = SVG_PLAYER_MANIFEST.segments.map((segment) => ({
  id: segment.id,
  text: segment.text,
  audioUrl: toMockUrl(segment.audio),
  ocrUrl: toMockUrl(segment.ocr),
  ttsUrl: toMockUrl(segment.tts),
}));

export const SVG_PLAYER_USED_MOCK_FILES = [
  SVG_PLAYER_MANIFEST.image,
  ...SVG_PLAYER_MANIFEST.segments.flatMap((segment) => [segment.audio, segment.ocr, segment.tts]),
];
