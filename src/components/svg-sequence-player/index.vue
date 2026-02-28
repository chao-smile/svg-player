<template>
  <div
    class="root"
    :class="{ 'blend-supported': supportsBlendMode }"
    :style="themeVars"
  >
    <div class="status">
      <span v-if="playerState === 'loading'">加载段落数据中...</span>
      <span v-else-if="playerState === 'error'" class="err">{{
        errorText
      }}</span>
      <span v-else>{{ hint }}</span>
    </div>

    <div
      class="stage"
      v-if="
        displayMode === 'image' &&
        segments.length &&
        imageWidth > 0 &&
        imageHeight > 0
      "
    >
      <img class="image" :src="imageUrl" alt="shared image" />
      <svg
        class="overlay"
        :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <template v-for="segment in segments" :key="segment.id">
            <clipPath
              v-for="run in segment.runs"
              :key="run.id"
              :id="`clip-${run.id}`"
              clipPathUnits="userSpaceOnUse"
            >
              <rect
                :x="expandBox(run.bbox).x"
                :y="expandBox(run.bbox).y"
                :width="
                  expandBox(run.bbox).w *
                  (segment.id === activeSegmentId()
                    ? (runProgress[run.id] ?? 0)
                    : 0)
                "
                :height="expandBox(run.bbox).h"
                :rx="highlightRadius"
                :ry="highlightRadius"
              />
            </clipPath>
          </template>
        </defs>

        <g v-for="segment in segments" :key="segment.id">
          <g v-for="run in segment.runs" :key="run.id">
            <rect
              v-if="props.showOutline"
              class="base"
              :class="{ active: segment.id === activeSegmentId() }"
              :x="expandBox(run.bbox).x"
              :y="expandBox(run.bbox).y"
              :width="expandBox(run.bbox).w"
              :height="expandBox(run.bbox).h"
              :rx="highlightRadius"
              :ry="highlightRadius"
            />
            <rect
              class="fill"
              :x="expandBox(run.bbox).x"
              :y="expandBox(run.bbox).y"
              :width="expandBox(run.bbox).w"
              :height="expandBox(run.bbox).h"
              :clip-path="`url(#clip-${run.id})`"
              :rx="highlightRadius"
              :ry="highlightRadius"
            />
          </g>
        </g>
      </svg>
    </div>

    <div
      v-else-if="displayMode === 'text' && segments.length"
      ref="textStageRef"
      class="text-stage"
      @scroll.passive="handleTextStageScroll"
      @wheel.passive="handleTextStageUserInteraction"
      @touchstart.passive="handleTextStageUserInteraction"
    >
      <div class="text-content">
        <div aria-hidden="true" class="text-spacer" :style="textSpacerStyle" />
        <p
          v-for="(line, index) in textLines"
          :key="line.id"
          :ref="(el) => bindTextLineEl(line.id, el)"
          class="text-segment"
          :class="{ active: index === activeTextLineIndex }"
          :style="textLineStyle(index, line)"
        >
          {{ line.text }}
        </p>
        <div aria-hidden="true" class="text-spacer" :style="textSpacerStyle" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { computeRunProgress, expandBox, loadSegmentModels } from "./model";
import type {
  PlayerState,
  RunModel,
  SegmentAsset,
  SegmentModel,
  SvgSequencePlayerExpose,
  WordModel,
} from "./types";

type DisplayMode = "image" | "text";
type TextLineModel = {
  id: string;
  text: string;
  segmentIndex: number;
  segmentId: string;
  t0: number;
  t1: number;
};

const props = withDefaults(
  defineProps<{
    imageUrl: string;
    segmentAssets: SegmentAsset[];
    showOutline?: boolean;
    highlightColor?: string;
    highlightRadius?: number;
    playbackRate?: number;
    displayMode?: DisplayMode;
    autoFollowText?: boolean;
    autoFollowResumeDelayMs?: number;
  }>(),
  {
    showOutline: false,
    highlightColor: "#f2b4ae",
    highlightRadius: 0,
    playbackRate: 1,
    displayMode: "image",
    autoFollowText: true,
    autoFollowResumeDelayMs: 1800,
  },
);

const emit = defineEmits<{
  (e: "finished"): void;
  (e: "state-change", state: PlayerState): void;
}>();

const playerState = ref<PlayerState>("loading");
const errorText = ref("");
const imageWidth = ref(0);
const imageHeight = ref(0);
const segments = ref<SegmentModel[]>([]);
const currentSegmentIndex = ref<number>(-1);
const currentTimeMs = ref(0);
const runProgress = reactive<Record<string, number>>({});
const textStageRef = ref<HTMLElement | null>(null);
const textLineEls = new Map<string, HTMLElement>();
const textStageHeight = ref(0);
let textStageResizeObserver: ResizeObserver | null = null;
const textAutoFollowAllowed = ref(true);
let textAutoFollowResumeTimer = 0;
let lastProgrammaticScrollAt = 0;

const audio = new Audio();
let raf = 0;
let stopAtMs: number | null = null;
let sequenceToken = 0;
let resolveSegment: ((ok: boolean) => void) | null = null;
let cleanupSegmentListeners: (() => void) | null = null;
let lastRenderedSegmentIndex = -1;

function setState(next: PlayerState) {
  if (playerState.value === next) return;
  playerState.value = next;
  emit("state-change", next);
}

function stopRaf() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function applyPlaybackRate(rate: number) {
  audio.playbackRate = rate;
  // In some WebView/browser combinations this helps make the speed change obvious.
  if ("preservesPitch" in audio) {
    (audio as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch =
      false;
  }
}

function resetAllProgress() {
  for (const segment of segments.value) {
    for (const run of segment.runs) runProgress[run.id] = 0;
  }
}

function resetSegmentRunProgress(segmentIndex: number) {
  const segment = segments.value[segmentIndex];
  if (!segment) return;
  for (const run of segment.runs) runProgress[run.id] = 0;
}

function settleSegment(ok: boolean) {
  if (!resolveSegment) return;
  cleanupSegmentListeners?.();
  cleanupSegmentListeners = null;
  const fn = resolveSegment;
  resolveSegment = null;
  fn(ok);
}

function activeSegmentId() {
  const idx = currentSegmentIndex.value;
  if (idx < 0 || idx >= segments.value.length) return null;
  return segments.value[idx]?.id ?? null;
}

function tick() {
  const activeIndex = currentSegmentIndex.value;
  const active = segments.value[activeIndex];
  if (!active) {
    stopRaf();
    return;
  }

  const tMs = audio.currentTime * 1000;
  currentTimeMs.value = tMs;
  for (const run of active.runs) {
    const next = computeRunProgress(run, tMs);
    const prev = runProgress[run.id] ?? 0;
    runProgress[run.id] = Math.max(prev, next);
  }
  centerActiveTextLine("auto");

  if (stopAtMs != null && tMs >= stopAtMs) {
    for (const run of active.runs) runProgress[run.id] = 1;
    audio.pause();
    stopRaf();
    settleSegment(true);
    return;
  }

  raf = requestAnimationFrame(tick);
}

function seekToMs(ms: number, token: number) {
  const target = ms / 1000;
  if (Math.abs(audio.currentTime - target) < 0.015) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let done = false;
    const onSeeked = () => {
      if (done) return;
      done = true;
      resolve();
    };
    audio.addEventListener("seeked", onSeeked, { once: true });
    audio.currentTime = target;
    window.setTimeout(() => {
      if (done) return;
      done = true;
      resolve();
    }, 250);
  }).then(() => {
    if (token !== sequenceToken) throw new Error("stale");
  });
}

async function playSegment(index: number, token: number): Promise<boolean> {
  const segment = segments.value[index];
  if (!segment) return false;

  if (lastRenderedSegmentIndex >= 0 && lastRenderedSegmentIndex !== index) {
    resetSegmentRunProgress(lastRenderedSegmentIndex);
  }
  lastRenderedSegmentIndex = index;
  currentSegmentIndex.value = index;
  currentTimeMs.value = segment.t0;
  stopAtMs = segment.t1;

  if (audio.src !== segment.audioUrl) {
    audio.src = segment.audioUrl;
    audio.preload = "auto";
    audio.load();
  }

  try {
    applyPlaybackRate(effectivePlaybackRate.value);
    await seekToMs(segment.t0, token);
    if (token !== sequenceToken) return false;

    await audio.play();
    if (token !== sequenceToken) return false;
    applyPlaybackRate(effectivePlaybackRate.value);

    stopRaf();
    raf = requestAnimationFrame(tick);
  } catch (e) {
    if (String((e as Error)?.message ?? e) !== "stale") {
      console.error(e);
    }
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const onEnded = () => settleSegment(true);
    const onError = () => settleSegment(false);
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });

    cleanupSegmentListeners = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };

    resolveSegment = resolve;
  });
}

function stopInternal(setIdleState = true) {
  sequenceToken += 1;
  stopAtMs = null;
  lastRenderedSegmentIndex = -1;
  currentTimeMs.value = 0;
  audio.pause();
  stopRaf();
  settleSegment(false);
  currentSegmentIndex.value = -1;
  resetAllProgress();
  if (setIdleState) setState(errorText.value ? "error" : "idle");
}

async function playAll() {
  if (
    !segments.value.length ||
    playerState.value === "loading" ||
    playerState.value === "error"
  )
    return;

  stopInternal(false);
  resetAllProgress();
  setState("playing");

  sequenceToken += 1;
  const token = sequenceToken;

  for (let i = 0; i < segments.value.length; i++) {
    const ok = await playSegment(i, token);
    if (!ok || token !== sequenceToken) return;
  }

  audio.pause();
  stopRaf();
  currentSegmentIndex.value = -1;
  lastRenderedSegmentIndex = -1;
  currentTimeMs.value = 0;
  setState("idle");
  emit("finished");
}

function pause() {
  if (playerState.value !== "playing") return;
  audio.pause();
  stopRaf();
  setState("paused");
}

async function resume() {
  if (playerState.value !== "paused") return;
  try {
    await audio.play();
    setState("playing");
    stopRaf();
    raf = requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
  }
}

function togglePause() {
  if (playerState.value === "playing") {
    pause();
    return;
  }
  if (playerState.value === "paused") {
    void resume();
  }
}

function stop() {
  stopInternal(true);
}

async function loadModels() {
  setState("loading");
  errorText.value = "";
  try {
    const loaded = await loadSegmentModels(props.segmentAssets);
    imageWidth.value = loaded.imageWidth;
    imageHeight.value = loaded.imageHeight;
    segments.value = loaded.segments;
    resetAllProgress();
    setState("idle");
  } catch (e) {
    errorText.value = String((e as Error)?.message ?? e);
    setState("error");
  }
}

const hint = computed(() => {
  const runs = segments.value.reduce(
    (count, segment) => count + segment.runs.length,
    0,
  );
  const timedWords = segments.value.reduce(
    (count, segment) =>
      count +
      segment.runs.reduce(
        (runCount, run) =>
          runCount + run.words.filter((w) => typeof w.t0 === "number").length,
        0,
      ),
    0,
  );
  return `segments=${segments.value.length}, runs=${runs}, timedWords=${timedWords}`;
});

const themeVars = computed(() => ({
  "--hl-color": props.highlightColor,
  "--hl-soft-color": toSoftColor(props.highlightColor, 0.56),
  "--seg-radius": String(Math.max(0, props.highlightRadius ?? 0)),
}));

const displayMode = computed<DisplayMode>(() =>
  props.displayMode === "text" ? "text" : "image",
);
const highlightRadius = computed(() => Math.max(0, props.highlightRadius ?? 0));
const effectivePlaybackRate = computed(() => {
  const rate = Number(props.playbackRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
});
const effectiveAutoFollowResumeDelay = computed(() => {
  const delay = Number(props.autoFollowResumeDelayMs);
  return Number.isFinite(delay) && delay >= 0 ? delay : 1800;
});

const supportsBlendMode =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("mix-blend-mode", "multiply");

function toSoftColor(color: string, alpha: number): string {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16);
    const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16);
    const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1]!
      .split(",")
      .slice(0, 3)
      .map((v) => Number.parseFloat(v.trim()));
    if ([r, g, b].every((v) => Number.isFinite(v))) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  return `rgba(242, 180, 174, ${safeAlpha})`;
}

function bindTextLineEl(
  id: string,
  el: Element | { $el?: Element | null } | null,
) {
  const node =
    el instanceof HTMLElement
      ? el
      : el && "$el" in el && el.$el instanceof HTMLElement
        ? el.$el
        : null;

  if (node) {
    textLineEls.set(id, node);
  } else {
    textLineEls.delete(id);
  }
}

function formatLineText(words: WordModel[]): string {
  const punct = /^[,.;:!?，。！？、）》】\])]+$/;
  const joined: string[] = [];
  for (const word of words) {
    if (!joined.length || punct.test(word.text)) {
      joined.push(word.text);
    } else {
      joined.push(` ${word.text}`);
    }
  }
  return joined.join("").trim();
}

function lineTimeRange(run: RunModel, segment: SegmentModel) {
  const timedWords = run.words.filter(
    (w): w is WordModel & { t0: number; t1: number } =>
      typeof w.t0 === "number" && typeof w.t1 === "number",
  );
  if (!timedWords.length) return { t0: segment.t0, t1: segment.t1 };
  return {
    t0: Math.min(...timedWords.map((w) => w.t0)),
    t1: Math.max(...timedWords.map((w) => w.t1)),
  };
}

const textLines = computed<TextLineModel[]>(() =>
  segments.value.flatMap((segment, segmentIndex) =>
    segment.runs.map((run, runIndex) => {
      const range = lineTimeRange(run, segment);
      return {
        id: `${segment.id}-line-${runIndex + 1}`,
        text: formatLineText(run.words),
        segmentIndex,
        segmentId: segment.id,
        t0: range.t0,
        t1: range.t1,
      };
    }),
  ),
);

const activeTextLineIndex = computed(() => {
  if (currentSegmentIndex.value < 0) return -1;
  const currentLines = textLines.value;
  if (!currentLines.length) return -1;

  const currentSegmentLines = currentLines.filter(
    (line) => line.segmentIndex === currentSegmentIndex.value,
  );
  if (!currentSegmentLines.length) return -1;

  const tMs = currentTimeMs.value;
  const activeCandidates = currentSegmentLines.filter(
    (line) => tMs >= line.t0 && tMs < line.t1,
  );
  if (activeCandidates.length) {
    const activeLine = activeCandidates.reduce((best, current) =>
      current.t0 > best.t0 ? current : best,
    );
    return currentLines.findIndex((line) => line.id === activeLine.id);
  }

  if (tMs < currentSegmentLines[0]!.t0) {
    return currentLines.findIndex(
      (line) => line.id === currentSegmentLines[0]!.id,
    );
  }
  return currentLines.findIndex(
    (line) =>
      line.id === currentSegmentLines[currentSegmentLines.length - 1]!.id,
  );
});

const textSpacerStyle = computed(() => {
  const h = Math.max(0, textStageHeight.value / 2);
  return { height: `${h}px` };
});

function lineProgress(index: number, line: TextLineModel): number {
  if (activeTextLineIndex.value < 0) return 0;
  if (index !== activeTextLineIndex.value) return 0;
  const duration = Math.max(1, line.t1 - line.t0);
  return Math.max(0, Math.min(1, (currentTimeMs.value - line.t0) / duration));
}

function textLineStyle(index: number, line: TextLineModel) {
  return {
    "--seg-progress": `${(lineProgress(index, line) * 100).toFixed(2)}%`,
  };
}

function shouldAutoFollowText() {
  return (
    displayMode.value === "text" &&
    props.autoFollowText &&
    textAutoFollowAllowed.value
  );
}

function centerActiveTextLine(
  behavior: ScrollBehavior = "smooth",
  force = false,
) {
  if (!force && !shouldAutoFollowText()) return;
  if (displayMode.value !== "text") return;
  const stage = textStageRef.value;
  if (!stage) return;
  if (activeTextLineIndex.value < 0) return;
  const activeLine = textLines.value[activeTextLineIndex.value];
  if (!activeLine) return;
  const activeEl = textLineEls.get(activeLine.id);
  if (!activeEl) return;

  const stageRect = stage.getBoundingClientRect();
  const activeRect = activeEl.getBoundingClientRect();
  const targetTop =
    stage.scrollTop +
    (activeRect.top + activeRect.height / 2) -
    (stageRect.top + stageRect.height / 2);
  const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
  const nextTop = Math.max(0, Math.min(targetTop, maxTop));
  lastProgrammaticScrollAt = Date.now();
  if (behavior === "auto") {
    if (Math.abs(stage.scrollTop - nextTop) > 0.5) stage.scrollTop = nextTop;
    return;
  }
  stage.scrollTo({ top: nextTop, behavior });
}

function syncTextStageSize() {
  const stage = textStageRef.value;
  textStageHeight.value = stage?.clientHeight ?? 0;
}

function bindTextStageObserver() {
  textStageResizeObserver?.disconnect();
  textStageResizeObserver = null;
  const stage = textStageRef.value;
  if (!stage || typeof ResizeObserver === "undefined") {
    syncTextStageSize();
    return;
  }

  textStageResizeObserver = new ResizeObserver(() => {
    syncTextStageSize();
    centerActiveTextLine("auto");
  });
  textStageResizeObserver.observe(stage);
  syncTextStageSize();
}

function scheduleAutoFollowResume() {
  window.clearTimeout(textAutoFollowResumeTimer);
  textAutoFollowResumeTimer = window.setTimeout(() => {
    textAutoFollowAllowed.value = true;
    centerActiveTextLine("smooth", true);
  }, effectiveAutoFollowResumeDelay.value);
}

function handleTextStageUserInteraction() {
  if (!props.autoFollowText || displayMode.value !== "text") return;
  textAutoFollowAllowed.value = false;
  scheduleAutoFollowResume();
}

function handleTextStageScroll() {
  if (Date.now() - lastProgrammaticScrollAt < 120) return;
  handleTextStageUserInteraction();
}

watch(
  () => props.segmentAssets,
  () => {
    stopInternal(false);
    void loadModels();
  },
  { immediate: true },
);

watch(
  effectivePlaybackRate,
  (rate) => {
    applyPlaybackRate(rate);
  },
  { immediate: true },
);

watch(activeTextLineIndex, () => {
  void nextTick(() => {
    centerActiveTextLine("smooth");
  });
});

watch(displayMode, (mode) => {
  window.clearTimeout(textAutoFollowResumeTimer);
  textAutoFollowAllowed.value = true;
  if (mode !== "text") return;
  void nextTick(() => {
    centerActiveTextLine("auto", true);
  });
});

watch(
  () => props.autoFollowText,
  (enabled) => {
    if (!enabled) {
      window.clearTimeout(textAutoFollowResumeTimer);
      textAutoFollowAllowed.value = false;
      return;
    }
    textAutoFollowAllowed.value = true;
    centerActiveTextLine("smooth", true);
  },
  { immediate: true },
);

watch(textStageRef, () => {
  bindTextStageObserver();
});

watch(textLines, () => {
  void nextTick(() => {
    centerActiveTextLine("auto", true);
  });
});

onMounted(() => {
  bindTextStageObserver();
  emit("state-change", playerState.value);
});

onBeforeUnmount(() => {
  window.clearTimeout(textAutoFollowResumeTimer);
  textStageResizeObserver?.disconnect();
  textStageResizeObserver = null;
  stopInternal(false);
});

defineExpose<SvgSequencePlayerExpose>({
  playAll,
  pause,
  resume,
  togglePause,
  stop,
  getState: () => playerState.value,
});
</script>

<style scoped>
.root {
  display: grid;
  gap: 10px;
  --hl-color: #f2b4ae;
}

.status {
  font-size: 12px;
  color: #374151;
}

.err {
  color: #b00020;
}

.stage {
  position: relative;
  width: min(100%, 1100px);
  isolation: isolate;
}

.image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
}

.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.text-stage {
  width: min(100%, 1100px);
  height: clamp(260px, 62vh, 620px);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.text-stage::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.text-content {
  min-height: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 0 12px;
  display: grid;
  justify-items: center;
  gap: 22px;
}

.text-spacer {
  width: 1px;
}

.text-segment {
  margin: 0;
  font-size: clamp(24px, 3vw, 42px);
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: #1f2937;
  width: fit-content;
  max-width: 100%;
  text-wrap: pretty;
  text-align: center;
  padding: 0.1em 0.24em;
  border-radius: calc(var(--seg-radius, 0) * 1px);
  background: linear-gradient(
    to right,
    var(--hl-soft-color) 0 var(--seg-progress),
    transparent var(--seg-progress) 100%
  );
  transition:
    background 140ms linear,
    opacity 180ms ease;
}

.text-segment.active {
  opacity: 1;
}

.base {
  fill: var(--hl-color);
  fill-opacity: 0.08;
  stroke: var(--hl-color);
  stroke-opacity: 0.3;
  stroke-width: 1;
}

.base.active {
  stroke: var(--hl-color);
  stroke-opacity: 0.95;
  stroke-width: 2;
}

.fill {
  fill: var(--hl-color);
  fill-opacity: 0.32;
  stroke: none;
}

.blend-supported .fill {
  fill-opacity: 0.6;
  mix-blend-mode: multiply;
}
</style>
