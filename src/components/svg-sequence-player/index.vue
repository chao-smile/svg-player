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
                :x="run.expandedBBox.x"
                :y="run.expandedBBox.y"
                :width="
                  run.expandedBBox.w *
                  (segment.id === activeSegmentIdValue
                    ? (runProgress[run.id] ?? 0)
                    : 0)
                "
                :height="run.expandedBBox.h"
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
              :class="{ active: segment.id === activeSegmentIdValue }"
              :x="run.expandedBBox.x"
              :y="run.expandedBBox.y"
              :width="run.expandedBBox.w"
              :height="run.expandedBBox.h"
              :rx="highlightRadius"
              :ry="highlightRadius"
            />
            <rect
              class="fill"
              :x="run.expandedBBox.x"
              :y="run.expandedBBox.y"
              :width="run.expandedBBox.w"
              :height="run.expandedBBox.h"
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
  onUpdated,
  reactive,
  ref,
} from "vue";
import { computeRunProgress, loadSegmentModels } from "./model";
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

// 组件入参：图片地址、分段资源与播放器外观/行为配置。
const props = withDefaults(
  defineProps<{
    imageUrl: string;
    segmentAssets: SegmentAsset[];
    sourceImageWidth?: number;
    sourceImageHeight?: number;
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

// 对外事件：播放完成与内部状态变化。
const emit = defineEmits<{
  (e: "finished"): void;
  (e: "state-change", state: PlayerState): void;
}>();

// 播放器当前状态（loading/idle/playing/paused/error）。
const playerState = ref<PlayerState>("loading");
// 错误文本：模型加载或播放失败时展示。
const errorText = ref("");
// 图片坐标系宽度（用于 SVG overlay viewBox）。
const imageWidth = ref(0);
// 图片坐标系高度（用于 SVG overlay viewBox）。
const imageHeight = ref(0);
// 归一化后的分段模型数组。
const segments = ref<SegmentModel[]>([]);
// 当前活跃分段索引，-1 表示无活跃分段。
const currentSegmentIndex = ref<number>(-1);
// 当前播放时间（毫秒）。
const currentTimeMs = ref(0);
// 每个 run 的高亮进度缓存（0~1）。
const runProgress = reactive<Record<string, number>>({});
// 文本模式滚动容器引用。
const textStageRef = ref<HTMLElement | null>(null);
// 文本行 DOM 索引（line.id -> HTMLElement）。
const textLineEls = new Map<string, HTMLElement>();
// 文本容器高度缓存，用于顶部/底部 spacer 计算。
const textStageHeight = ref(0);
// 文本容器 ResizeObserver 实例。
let textStageResizeObserver: ResizeObserver | null = null;
// 当前被观察的文本容器节点，用于避免重复绑定 observer。
let observedTextStageEl: HTMLElement | null = null;
// 是否允许自动跟随文本到激活行。
const textAutoFollowAllowed = ref(true);
// 自动跟随恢复定时器 id。
let textAutoFollowResumeTimer = 0;
// 最近一次程序触发滚动的时间戳（用于区分用户滚动）。
let lastProgrammaticScrollAt = 0;

// 全局复用的底层音频实例。
const audio = new Audio();
// requestAnimationFrame 句柄。
let raf = 0;
// 当前分段停止时间（毫秒）。
let stopAtMs: number | null = null;
// 播放流程令牌：用于中断旧异步流程。
let sequenceToken = 0;
// 当前分段播放 Promise 的 resolve 回调。
let resolveSegment: ((ok: boolean) => void) | null = null;
// 当前分段事件监听清理函数。
let cleanupSegmentListeners: (() => void) | null = null;
// 上一次渲染的分段索引。
let lastRenderedSegmentIndex = -1;
// 上一次 segmentAssets 引用快照（用于显式对比更新）。
let prevSegmentAssetsRef: SegmentAsset[] | null = null;
// 上一次 imageUrl 快照（用于显式对比更新）。
let prevImageUrl = "";
// 上一次倍速快照（避免重复写入 audio.playbackRate）。
let prevPlaybackRate = NaN;
// 上一次展示模式快照（用于模式切换副作用控制）。
let prevDisplayMode: DisplayMode | null = null;
// 上一次自动跟随开关快照。
let prevAutoFollowText: boolean | null = null;

// 更新并广播播放器状态，避免重复派发相同状态。
function setState(next: PlayerState) {
  if (playerState.value === next) return;
  playerState.value = next;
  emit("state-change", next);
}

// 停止当前 RAF 循环，终止逐帧进度更新。
function stopRaf() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// 将外部倍速同步到底层 audio 对象。
function applyPlaybackRate(rate: number) {
  audio.playbackRate = rate;
  // In some WebView/browser combinations this helps make the speed change obvious.
  if ("preservesPitch" in audio) {
    (audio as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch =
      false;
  }
}

// 重置所有分段/行的高亮进度。
function resetAllProgress() {
  for (const segment of segments.value) {
    for (const run of segment.runs) runProgress[run.id] = 0;
  }
}

// 仅重置指定分段的行进度，用于切换分段时清理历史痕迹。
function resetSegmentRunProgress(segmentIndex: number) {
  const segment = segments.value[segmentIndex];
  if (!segment) return;
  for (const run of segment.runs) runProgress[run.id] = 0;
}

// 结束当前 segment 的等待 Promise（成功/失败）。
function settleSegment(ok: boolean) {
  if (!resolveSegment) return;
  cleanupSegmentListeners?.();
  cleanupSegmentListeners = null;
  const fn = resolveSegment;
  resolveSegment = null;
  fn(ok);
}

// 获取当前活跃分段 id（无活跃分段时返回 null）。
function activeSegmentId() {
  const idx = currentSegmentIndex.value;
  if (idx < 0 || idx >= segments.value.length) return null;
  return segments.value[idx]?.id ?? null;
}
// 活跃分段 id 的计算结果缓存，减少模板重复调用函数。
const activeSegmentIdValue = computed(() => activeSegmentId());

// 播放中的逐帧主循环：推进高亮进度并处理分段结束。
function tick() {
  const activeIndex = currentSegmentIndex.value;
  const active = segments.value[activeIndex];
  if (!active) {
    stopRaf();
    return;
  }

  const tMs = audio.currentTime * 1000;
  currentTimeMs.value = tMs;
  // 按当前音频时间推进每一行 run 的高亮进度，保证只增不减。
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

// 跳转音频到指定毫秒，带 token 防抖避免过期流程继续执行。
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

// 播放单个分段并返回是否成功完成。
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

    // RAF 驱动视觉更新，避免只靠 audio 事件导致更新不连续。
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

// 内部停止：中断当前流程并重置状态（可选择是否回到 idle/error）。
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

// 串行播放全部 segments；若 token 变化说明被中断，立即退出。
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

// 暂停播放并保持当前进度。
function pause() {
  if (playerState.value !== "playing") return;
  audio.pause();
  stopRaf();
  setState("paused");
}

// 从暂停状态恢复播放。
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

// 根据当前状态在暂停/继续之间切换。
function togglePause() {
  if (playerState.value === "playing") {
    pause();
    return;
  }
  if (playerState.value === "paused") {
    void resume();
  }
}

// 对外暴露的停止动作，结束当前播放并回到可重播状态。
function stop() {
  stopInternal(true);
}

// 读取图片原始尺寸，作为坐标系基准。
function resolveImageSize(url: string): Promise<{ width: number; height: number }> {
  const src = url.trim();
  if (!src) return Promise.resolve({ width: 0, height: 0 });
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      });
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

// 加载并归一化 segment 数据模型，构建可渲染运行时状态。
async function loadModels() {
  setState("loading");
  errorText.value = "";
  try {
    const widthFromProp = Number(props.sourceImageWidth);
    const heightFromProp = Number(props.sourceImageHeight);
    const hasWidthFromProp = Number.isFinite(widthFromProp) && widthFromProp > 0;
    const hasHeightFromProp =
      Number.isFinite(heightFromProp) && heightFromProp > 0;

    const imageMeta =
      hasWidthFromProp && hasHeightFromProp
        ? { width: widthFromProp, height: heightFromProp }
        : await resolveImageSize(props.imageUrl);

    const imageWidthBase = hasWidthFromProp ? widthFromProp : imageMeta.width;
    const imageHeightBase = hasHeightFromProp ? heightFromProp : imageMeta.height;

    // 将 OCR/TTS 原始数据归一化为可渲染的运行模型。
    const loaded = await loadSegmentModels(props.segmentAssets, {
      imageWidth: imageWidthBase,
      imageHeight: imageHeightBase,
    });
    imageWidth.value = loaded.imageWidth || imageWidthBase;
    imageHeight.value = loaded.imageHeight || imageHeightBase;
    segments.value = loaded.segments;
    resetAllProgress();
    setState("idle");
    void nextTick(() => {
      centerActiveTextLine("auto", true);
    });
  } catch (e) {
    errorText.value = String((e as Error)?.message ?? e);
    setState("error");
  }
}

// 主题变量：提供给样式层的高亮色与圆角参数。
const themeVars = computed(() => ({
  "--hl-color": props.highlightColor,
  "--hl-soft-color": toSoftColor(props.highlightColor, 0.56),
  "--seg-radius": String(Math.max(0, props.highlightRadius ?? 0)),
}));

// 当前展示模式（image/text），无效值兜底到 image。
const displayMode = computed<DisplayMode>(() =>
  props.displayMode === "text" ? "text" : "image",
);
// 高亮圆角半径（负值保护）。
const highlightRadius = computed(() => Math.max(0, props.highlightRadius ?? 0));
// 实际播放倍速（非法值回退到 1）。
const effectivePlaybackRate = computed(() => {
  const rate = Number(props.playbackRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
});
// 自动跟随恢复延时（毫秒，非法值回退到默认值）。
const effectiveAutoFollowResumeDelay = computed(() => {
  const delay = Number(props.autoFollowResumeDelayMs);
  return Number.isFinite(delay) && delay >= 0 ? delay : 1800;
});

// 浏览器是否支持混合模式（用于高亮叠加效果）。
const supportsBlendMode =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("mix-blend-mode", "multiply");

// 将高亮色转成带透明度的 rgba，供进度背景渐变使用。
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

// 记录/移除文本行 DOM 引用，供居中滚动计算使用。
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

// 将一行词列表拼接成人类可读文本（处理标点前空格）。
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

// 计算单行时间范围，若词没有时间则回退到分段范围。
function lineTimeRange(run: RunModel, segment: SegmentModel) {
  const timedWords = run.timedWords;
  if (!timedWords.length) return { t0: segment.t0, t1: segment.t1 };
  return {
    t0: Math.min(...timedWords.map((w) => w.t0)),
    t1: Math.max(...timedWords.map((w) => w.t1)),
  };
}

// 文本模式行数据：由分段 runs 动态映射而来。
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

// 当前文本模式活跃行索引。
const activeTextLineIndex = computed(() => {
  if (currentSegmentIndex.value < 0) return -1;
  const currentLines = textLines.value;
  if (!currentLines.length) return -1;

  const currentSegmentLines = currentLines.filter(
    (line) => line.segmentIndex === currentSegmentIndex.value,
  );
  if (!currentSegmentLines.length) return -1;

  const tMs = currentTimeMs.value;
  // 文本模式下优先匹配“当前时间命中的行”，否则回退到首行/末行。
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

// 文本模式上下 spacer 样式（用于视觉居中）。
const textSpacerStyle = computed(() => {
  const h = Math.max(0, textStageHeight.value / 2);
  return { height: `${h}px` };
});

// 计算当前激活行的阅读进度（0~1）。
function lineProgress(index: number, line: TextLineModel): number {
  if (activeTextLineIndex.value < 0) return 0;
  if (index !== activeTextLineIndex.value) return 0;
  const duration = Math.max(1, line.t1 - line.t0);
  return Math.max(0, Math.min(1, (currentTimeMs.value - line.t0) / duration));
}

// 生成文本行样式变量，用于驱动行内背景进度渲染。
function textLineStyle(index: number, line: TextLineModel) {
  return {
    "--seg-progress": `${(lineProgress(index, line) * 100).toFixed(2)}%`,
  };
}

// 判断当前是否允许自动跟随到激活行。
function shouldAutoFollowText() {
  return (
    displayMode.value === "text" &&
    props.autoFollowText &&
    textAutoFollowAllowed.value
  );
}

// 将当前激活行滚动到可视区域垂直中心。
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
  // 记录程序触发的滚动时间，避免被当作用户手动滚动。
  lastProgrammaticScrollAt = Date.now();
  if (behavior === "auto") {
    if (Math.abs(stage.scrollTop - nextTop) > 0.5) stage.scrollTop = nextTop;
    return;
  }
  stage.scrollTo({ top: nextTop, behavior });
}

// 同步文本容器高度，供顶部/底部 spacer 计算。
function syncTextStageSize() {
  const stage = textStageRef.value;
  textStageHeight.value = stage?.clientHeight ?? 0;
}

// 为文本容器绑定 resize 监听，容器尺寸变化时重新居中。
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

// 用户手动滚动后延时恢复自动跟随。
function scheduleAutoFollowResume() {
  window.clearTimeout(textAutoFollowResumeTimer);
  textAutoFollowResumeTimer = window.setTimeout(() => {
    textAutoFollowAllowed.value = true;
    centerActiveTextLine("smooth", true);
  }, effectiveAutoFollowResumeDelay.value);
}

// 处理用户交互：暂时关闭自动跟随，避免与手势抢滚动。
function handleTextStageUserInteraction() {
  if (!props.autoFollowText || displayMode.value !== "text") return;
  textAutoFollowAllowed.value = false;
  scheduleAutoFollowResume();
}

// 处理文本容器滚动事件（忽略程序触发的滚动）。
function handleTextStageScroll() {
  if (Date.now() - lastProgrammaticScrollAt < 120) return;
  handleTextStageUserInteraction();
}

// 模式同步：进入文本模式时重置自动跟随状态并立即对齐到当前行。
function syncDisplayMode(force = false) {
  const mode = displayMode.value;
  if (!force && mode === prevDisplayMode) return;
  prevDisplayMode = mode;
  window.clearTimeout(textAutoFollowResumeTimer);
  textAutoFollowAllowed.value = true;
  if (mode !== "text") return;
  void nextTick(() => {
    centerActiveTextLine("auto", true);
  });
}

// 自动跟随开关同步：显式控制是否允许程序滚动文本窗口。
function syncAutoFollow(force = false) {
  const enabled = Boolean(props.autoFollowText);
  if (!force && enabled === prevAutoFollowText) return;
  prevAutoFollowText = enabled;
  if (!enabled) {
    window.clearTimeout(textAutoFollowResumeTimer);
    textAutoFollowAllowed.value = false;
    return;
  }
  textAutoFollowAllowed.value = true;
  centerActiveTextLine("smooth", true);
}

// 文本容器引用同步：DOM 节点变化时重绑 observer，避免监听过期节点。
function syncTextStageObserver(force = false) {
  const stage = textStageRef.value;
  if (!force && stage === observedTextStageEl) return;
  observedTextStageEl = stage;
  bindTextStageObserver();
}

// 倍速同步：仅当外部倍速实际变更时写入 audio，避免重复赋值。
function syncPlaybackRate(force = false) {
  const rate = effectivePlaybackRate.value;
  if (!force && rate === prevPlaybackRate) return;
  prevPlaybackRate = rate;
  applyPlaybackRate(rate);
}

// 数据源同步：segment 或 image 变化时重建模型，数据流入口集中在这里。
function syncSegmentSource(force = false) {
  const assetsChanged = prevSegmentAssetsRef !== props.segmentAssets;
  const imageChanged = prevImageUrl !== props.imageUrl;
  if (!force && !assetsChanged && !imageChanged) return;
  prevSegmentAssetsRef = props.segmentAssets;
  prevImageUrl = props.imageUrl;
  stopInternal(false);
  void loadModels();
}

// 首次挂载：强制跑一轮全量同步，初始化播放器可用状态。
onMounted(() => {
  syncSegmentSource(true);
  syncPlaybackRate(true);
  syncDisplayMode(true);
  syncAutoFollow(true);
  syncTextStageObserver(true);
  emit("state-change", playerState.value);
});

// 每次组件更新后执行“显式同步调度”，按需触发副作用（无 watch）。
onUpdated(() => {
  syncSegmentSource();
  syncPlaybackRate();
  syncDisplayMode();
  syncAutoFollow();
  syncTextStageObserver();
});

// 组件卸载时清理定时器、observer、音频播放流程。
onBeforeUnmount(() => {
  window.clearTimeout(textAutoFollowResumeTimer);
  textStageResizeObserver?.disconnect();
  textStageResizeObserver = null;
  observedTextStageEl = null;
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
