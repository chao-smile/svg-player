<template>
  <div class="root" :style="themeVars">
    <div class="status">
      <span v-if="playerState === 'loading'">加载段落数据中...</span>
      <span v-else-if="playerState === 'error'" class="err">{{
        errorText
      }}</span>
      <span v-else>{{ hint }}</span>
    </div>

    <div
      class="stage"
      v-if="segments.length && imageWidth > 0 && imageHeight > 0"
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
                rx="6"
                ry="6"
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
              rx="6"
              ry="6"
            />
            <rect
              class="fill"
              :x="expandBox(run.bbox).x"
              :y="expandBox(run.bbox).y"
              :width="expandBox(run.bbox).w"
              :height="expandBox(run.bbox).h"
              :clip-path="`url(#clip-${run.id})`"
              rx="6"
              ry="6"
            />
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { computeRunProgress, expandBox, loadSegmentModels } from "./model";
import type {
  PlayerState,
  SegmentAsset,
  SegmentModel,
  SvgSequencePlayerExpose,
} from "./types";

const props = withDefaults(
  defineProps<{
    imageUrl: string;
    segmentAssets: SegmentAsset[];
    showOutline?: boolean;
    highlightColor?: string;
  }>(),
  {
    showOutline: false,
    highlightColor: "#ffc107",
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
const runProgress = reactive<Record<string, number>>({});

const audio = new Audio();
let raf = 0;
let stopAtMs: number | null = null;
let sequenceToken = 0;
let resolveSegment: ((ok: boolean) => void) | null = null;
let cleanupSegmentListeners: (() => void) | null = null;

function setState(next: PlayerState) {
  if (playerState.value === next) return;
  playerState.value = next;
  emit("state-change", next);
}

function stopRaf() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function resetAllProgress() {
  for (const segment of segments.value) {
    for (const run of segment.runs) runProgress[run.id] = 0;
  }
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
  const activeId = activeSegmentId();
  if (!activeId) {
    stopRaf();
    return;
  }

  const tMs = audio.currentTime * 1000;
  for (const segment of segments.value) {
    const isActive = segment.id === activeId;
    for (const run of segment.runs) {
      if (!isActive) {
        runProgress[run.id] = 0;
        continue;
      }
      const next = computeRunProgress(run, tMs);
      const prev = runProgress[run.id] ?? 0;
      runProgress[run.id] = Math.max(prev, next);
    }
  }

  if (stopAtMs != null && tMs >= stopAtMs) {
    const active = segments.value.find((s) => s.id === activeId);
    if (active) {
      for (const run of active.runs) runProgress[run.id] = 1;
    }
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

  currentSegmentIndex.value = index;
  stopAtMs = segment.t1;

  if (audio.src !== segment.audioUrl) {
    audio.src = segment.audioUrl;
    audio.preload = "auto";
    audio.load();
  }

  try {
    await seekToMs(segment.t0, token);
    if (token !== sequenceToken) return false;

    await audio.play();
    if (token !== sequenceToken) return false;

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
}));

watch(
  () => props.segmentAssets,
  () => {
    stopInternal(false);
    void loadModels();
  },
  { immediate: true },
);

onMounted(() => {
  emit("state-change", playerState.value);
});

onBeforeUnmount(() => {
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
  --hl-color: #ffc107;
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
}

.base {
  fill: var(--hl-color);
  fill-opacity: 0.14;
  stroke: var(--hl-color);
  stroke-opacity: 0.38;
  stroke-width: 1;
}

.base.active {
  stroke: var(--hl-color);
  stroke-opacity: 0.95;
  stroke-width: 2;
}

.fill {
  fill: var(--hl-color);
  fill-opacity: 0.62;
  stroke: none;
}
</style>
