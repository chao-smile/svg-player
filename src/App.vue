<template>
  <main class="page">
    <header class="header">
      <h1>svg-player</h1>
      <p>
        基于共享图片 <code>test.png</code> + 5 组
        <code>audio/ocr/tts</code> 顺序播放。
      </p>
    </header>

    <section class="panel">
      <div class="line manifest-line">
        <b>Manifest:</b>
        <code class="manifest-code" :title="MANIFEST_URL">{{
          MANIFEST_URL
        }}</code>
      </div>
      <div v-if="manifest" class="line">
        <b>Segments:</b> {{ manifest.segment_count }}
      </div>
      <div class="line">
        <b>Used Mock Files:</b> {{ SVG_PLAYER_USED_MOCK_FILES.length }}
      </div>
      <div class="line"><b>View Mode:</b> {{ displayModeText }}</div>
      <div class="line"><b>Player State:</b> {{ playerState }}</div>
      <div class="line">
        <b>Finished Count:</b> {{ finishedCount
        }}<span v-if="finishedAt"> (last: {{ finishedAt }})</span>
      </div>

      <div class="actions">
        <button :disabled="!canPlay" @click="handleMainButton">
          {{ mainButtonText }}
        </button>
        <button :disabled="!canPause" @click="handlePauseButton">
          {{ pauseText }}
        </button>
        <button
          :disabled="!canAdjustRate"
          class="secondary"
          @click="handleSpeedButton"
        >
          {{ speedButtonText }}
        </button>
        <button
          :disabled="!canToggleMode"
          class="secondary"
          @click="handleModeButton"
        >
          {{ modeButtonText }}
        </button>
        <button :disabled="loading" class="secondary" @click="loadManifest">
          重新加载数据
        </button>
      </div>

      <div v-if="loading">加载 manifest 中...</div>
      <div v-else-if="errorText" class="error">{{ errorText }}</div>
    </section>

    <section
      class="panel player-panel"
      :class="{ 'text-mode': displayMode === 'text' }"
      v-if="segmentAssets.length && imageUrl"
    >
      <SvgSequencePlayer
        ref="playerRef"
        :image-url="imageUrl"
        :segment-assets="segmentAssets"
        :source-image-width="sourceImageWidth"
        :source-image-height="sourceImageHeight"
        :display-mode="displayMode"
        :playback-rate="playbackRate"
        @finished="onPlayerFinished"
        @state-change="onPlayerStateChange"
      />
    </section>

    <section class="panel" v-if="segmentAssets.length && imageUrl">
      <div class="title">SvgSequencePlayer Props</div>
      <pre class="props-preview">{{ playerPropsJson }}</pre>
    </section>

    <section class="panel" v-if="manifest">
      <div class="title">段落清单</div>
      <div v-for="item in manifest.segments" :key="item.id" class="segment-row">
        <code>{{ item.id }}</code>
        <span>{{ item.text }}</span>
        <span class="dim">{{ item.duration_ms }}ms</span>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { SvgSequencePlayer } from "./components/svg-sequence-player";
import type {
  PlayerState,
  SegmentAsset,
  SegmentManifest,
  SvgSequencePlayerExpose,
} from "./components/svg-sequence-player";
import {
  SVG_PLAYER_DATA_ROOT,
  SVG_PLAYER_IMAGE_URL,
  SVG_PLAYER_MANIFEST,
  SVG_PLAYER_MANIFEST_URL,
  SVG_PLAYER_SEGMENT_ASSETS,
  SVG_PLAYER_USED_MOCK_FILES,
} from "./mock/svgPlayerMock";

const MANIFEST_URL = `${SVG_PLAYER_MANIFEST_URL} (from ${SVG_PLAYER_DATA_ROOT})`;

// Demo 页面状态：加载、错误、当前传给播放器的数据。
const loading = ref(true);
const errorText = ref("");
const manifest = ref<SegmentManifest | null>(null);
const imageUrl = ref("");
const segmentAssets = ref<SegmentAsset[]>([]);

const playerRef = ref<SvgSequencePlayerExpose | null>(null);

// 仅用于演示控制面板和状态展示，不影响播放器内部逻辑。
const playerState = ref<PlayerState>("loading");
const finishedCount = ref(0);
const finishedAt = ref("");
const playbackRateOptions = [1, 1.25, 1.5, 2] as const;
const playbackRate = ref<number>(playbackRateOptions[0]);
const displayMode = ref<"image" | "text">("image");
const activePlayer = computed(() => playerRef.value);
// 示例：显式传入原图尺寸。若不传，播放器会退回到 imageUrl 自解析尺寸。
const sourceImageWidth = 1235;
const sourceImageHeight = 774;

async function loadManifest() {
  loading.value = true;
  errorText.value = "";
  try {
    manifest.value = SVG_PLAYER_MANIFEST;
    imageUrl.value = SVG_PLAYER_IMAGE_URL;
    segmentAssets.value = SVG_PLAYER_SEGMENT_ASSETS as SegmentAsset[];
  } catch (e) {
    errorText.value = String((e as Error)?.message ?? e);
  } finally {
    loading.value = false;
  }
}

// “开始/停止”按钮：空闲时播放全部，播放中则停止。
async function handleMainButton() {
  const player = activePlayer.value;
  if (!player) return;

  const state = playerState.value;
  if (state === "idle") {
    finishedAt.value = "";
    await player.playAll();
    return;
  }

  if (state === "playing" || state === "paused") {
    player.stop();
  }
}

function handlePauseButton() {
  activePlayer.value?.togglePause();
}

function handleSpeedButton() {
  const currentIndex = playbackRateOptions.findIndex(
    (rate) => rate === playbackRate.value,
  );
  const nextIndex =
    currentIndex >= 0 ? (currentIndex + 1) % playbackRateOptions.length : 0;
  playbackRate.value = playbackRateOptions[nextIndex]!;
}

function handleModeButton() {
  displayMode.value = displayMode.value === "image" ? "text" : "image";
}

// 由组件抛出的事件回填到 demo 状态栏。
function onPlayerFinished() {
  finishedCount.value += 1;
  finishedAt.value = new Date().toLocaleTimeString();
}

function onPlayerStateChange(state: PlayerState) {
  console.log("Player state changed:", state);
  playerState.value = state;
}

const mainButtonText = computed(() => {
  if (playerState.value === "playing" || playerState.value === "paused")
    return "停止播放";
  return `开始顺序播放 ${segmentAssets.value.length} 段`;
});

const canPlay = computed(
  () =>
    !loading.value &&
    !errorText.value &&
    segmentAssets.value.length > 0 &&
    (playerState.value === "idle" ||
      playerState.value === "playing" ||
      playerState.value === "paused"),
);
const canPause = computed(
  () => playerState.value === "playing" || playerState.value === "paused",
);
const canAdjustRate = computed(
  () => !loading.value && !errorText.value && segmentAssets.value.length > 0,
);
const canToggleMode = computed(
  () => !loading.value && !errorText.value && segmentAssets.value.length > 0,
);
const pauseText = computed(() =>
  playerState.value === "paused" ? "继续" : "暂停",
);
const speedButtonText = computed(() => `倍速 ${playbackRate.value}x`);
const modeButtonText = computed(() =>
  displayMode.value === "image" ? "切换纯文字" : "切换图文",
);
const displayModeText = computed(() =>
  displayMode.value === "image" ? "图文播放" : "纯文字播放",
);
const playerPropsData = computed(() => ({
  imageUrl: imageUrl.value,
  segmentAssets: segmentAssets.value,
  sourceImageWidth,
  sourceImageHeight,
  displayMode: displayMode.value,
  playbackRate: playbackRate.value,
}));
const playerPropsJson = computed(() =>
  JSON.stringify(playerPropsData.value, null, 2),
);

// 首次进入页面加载 mock 数据，并同步一次组件状态。
onMounted(async () => {
  await loadManifest();
  await nextTick();
  playerState.value = activePlayer.value?.getState() ?? "idle";
});
</script>

<style scoped>
.page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px;
  display: grid;
  gap: 14px;
}

.header h1 {
  margin: 0;
  font-size: 28px;
}

.header p {
  margin: 8px 0 0;
  color: #4b5563;
}

.panel {
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  display: grid;
  gap: 10px;
}

.player-panel {
  min-height: 260px;
}

.player-panel.text-mode {
  height: clamp(360px, 72vh, 760px);
  min-height: 0;
}

.player-panel.text-mode :deep(.root) {
  height: 100%;
  min-height: 0;
}

.line {
  font-size: 13px;
}

.manifest-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.manifest-code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

button {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #f9fafb;
  color: #111827;
  padding: 8px 12px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.secondary {
  background: #ffffff;
}

.error {
  color: #b00020;
}

.title {
  font-weight: 700;
  font-size: 14px;
}

.segment-row {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}

.props-preview {
  margin: 0;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
  max-height: 360px;
}

.dim {
  color: #6b7280;
}

@media (max-width: 768px) {
  .page {
    padding: 14px;
  }

  .header h1 {
    font-size: 24px;
  }

  .segment-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
