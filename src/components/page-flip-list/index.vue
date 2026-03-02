<template>
  <div class="flip-list" :style="durationVars">
    <div class="flip-stage">
      <div class="page page-current">
        <slot :item="currentItem" :index="displayIndex" />
      </div>

      <div
        v-if="isFlipping && leavingItem && leavingIndex >= 0"
        :key="`leave-${leavingIndex}-${flipRound}`"
        class="page page-turning"
        :class="turnClass"
        @animationend="handleFlipEnd"
      >
        <slot :item="leavingItem" :index="leavingIndex" />
        <span class="page-turn-shadow" />
        <span class="page-turn-gloss" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    items: any[];
    activeIndex: number;
    durationMs?: number;
  }>(),
  {
    durationMs: 760,
  },
);

const renderItems = computed(() => {
  if (props.items.length) return props.items;
  return [{ __placeholder: "empty-page" }];
});

const safeIndex = computed(() => {
  if (!renderItems.value.length) return 0;
  const idx = Math.trunc(props.activeIndex);
  if (idx < 0) return 0;
  if (idx >= renderItems.value.length) return renderItems.value.length - 1;
  return idx;
});

const displayIndex = ref(safeIndex.value);
const leavingIndex = ref(-1);
const pendingIndex = ref<number | null>(null);
const isFlipping = ref(false);
const flipRound = ref(0);
let flipTimer: number | null = null;

const currentItem = computed(() => renderItems.value[displayIndex.value] ?? null);
const leavingItem = computed(() =>
  leavingIndex.value >= 0 ? (renderItems.value[leavingIndex.value] ?? null) : null,
);
const turnClass = computed(() =>
  safeIndex.value >= leavingIndex.value ? "is-forward" : "is-backward",
);
const durationVars = computed(() => ({
  "--flip-duration": `${Math.max(260, props.durationMs)}ms`,
}));

function clearFlipTimer() {
  if (flipTimer === null) return;
  window.clearTimeout(flipTimer);
  flipTimer = null;
}

function finishFlip() {
  clearFlipTimer();
  isFlipping.value = false;
  leavingIndex.value = -1;

  if (pendingIndex.value === null || pendingIndex.value === displayIndex.value) {
    pendingIndex.value = null;
    return;
  }

  const queuedIndex = pendingIndex.value;
  pendingIndex.value = null;
  startFlip(queuedIndex);
}

function startFlip(targetIndex: number) {
  if (targetIndex === displayIndex.value) return;

  clearFlipTimer();
  leavingIndex.value = displayIndex.value;
  displayIndex.value = targetIndex;
  isFlipping.value = true;
  flipRound.value += 1;

  flipTimer = window.setTimeout(
    finishFlip,
    Math.max(220, props.durationMs + 80),
  );
}

function handleFlipEnd() {
  finishFlip();
}

watch(
  safeIndex,
  (nextIndex) => {
    if (!isFlipping.value) {
      startFlip(nextIndex);
      return;
    }

    pendingIndex.value = nextIndex;
  },
  { immediate: true },
);

watch(
  () => renderItems.value.length,
  () => {
    const clamped = safeIndex.value;
    pendingIndex.value = null;
    isFlipping.value = false;
    leavingIndex.value = -1;
    displayIndex.value = clamped;
    clearFlipTimer();
  },
);

onBeforeUnmount(() => {
  clearFlipTimer();
});
</script>

<style scoped>
.flip-list {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}

.flip-stage {
  width: 100%;
  aspect-ratio: 31 / 45;
  max-height: min(82vh, 920px);
  min-height: 500px;
  margin: 0 auto;
  perspective: 2200px;
  perspective-origin: 80% 88%;
  position: relative;
}

.page {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 14px;
  background: #fff;
  box-shadow:
    0 28px 56px rgba(15, 23, 42, 0.18),
    0 1px 0 rgba(15, 23, 42, 0.1);
}

.page-current {
  z-index: 1;
}

.page-turning {
  z-index: 4;
  pointer-events: none;
  transform-origin: 100% 100%;
  transform-style: preserve-3d;
  will-change: transform, clip-path, opacity, filter;
  animation: peel-forward var(--flip-duration) cubic-bezier(0.2, 0.82, 0.22, 1)
    both;
}

.page-turning.is-backward {
  transform-origin: 0% 100%;
  animation-name: peel-backward;
}

.page-turn-shadow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    302deg,
    rgba(0, 0, 0, 0.36) 0%,
    rgba(0, 0, 0, 0.16) 12%,
    rgba(0, 0, 0, 0) 32%
  );
  mix-blend-mode: multiply;
  animation: shadow-fade var(--flip-duration) ease both;
}

.page-turn-gloss {
  position: absolute;
  right: -12%;
  bottom: -12%;
  width: 56%;
  height: 56%;
  pointer-events: none;
  border-radius: 48% 52% 56% 44%;
  background: radial-gradient(
    circle at 4% 96%,
    rgba(255, 255, 255, 0.72) 0%,
    rgba(255, 255, 255, 0.22) 26%,
    rgba(255, 255, 255, 0) 72%
  );
  filter: blur(0.3px);
  animation: gloss-trace var(--flip-duration) ease both;
}

@keyframes peel-forward {
  0% {
    opacity: 1;
    transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate(0, 0)
      scale(1);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
    filter: brightness(1);
  }
  32% {
    transform: rotateX(0deg) rotateY(-8deg) rotateZ(2.8deg) translate(0.6%, 2%)
      scale(0.995);
    clip-path: polygon(0 0, 100% 0, 100% 80%, 0 100%);
  }
  62% {
    transform: rotateX(5deg) rotateY(-24deg) rotateZ(6deg) translate(7%, 14%)
      scale(0.98);
    clip-path: polygon(0 0, 100% 0, 100% 42%, 0 100%);
  }
  100% {
    opacity: 0;
    transform: rotateX(13deg) rotateY(-65deg) rotateZ(11deg)
      translate(38%, 28%) scale(0.9);
    clip-path: polygon(0 0, 100% 0, 100% 10%, 0 100%);
    filter: brightness(0.92);
  }
}

@keyframes peel-backward {
  0% {
    opacity: 1;
    transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate(0, 0) scale(1);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
    filter: brightness(1);
  }
  32% {
    transform: rotateX(0deg) rotateY(8deg) rotateZ(-2.8deg)
      translate(-0.6%, 2%) scale(0.995);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 80%);
  }
  62% {
    transform: rotateX(5deg) rotateY(24deg) rotateZ(-6deg) translate(-7%, 14%)
      scale(0.98);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 42%);
  }
  100% {
    opacity: 0;
    transform: rotateX(13deg) rotateY(65deg) rotateZ(-11deg)
      translate(-38%, 28%) scale(0.9);
    clip-path: polygon(0 10%, 100% 0, 100% 100%, 0 100%);
    filter: brightness(0.92);
  }
}

@keyframes shadow-fade {
  0% {
    opacity: 0.1;
  }
  35% {
    opacity: 0.48;
  }
  100% {
    opacity: 0;
  }
}

@keyframes gloss-trace {
  0% {
    opacity: 0;
    transform: rotate(0deg) translate(0, 0);
  }
  42% {
    opacity: 0.7;
  }
  100% {
    opacity: 0;
    transform: rotate(10deg) translate(-8%, -10%);
  }
}

@media (max-width: 768px) {
  .flip-list {
    max-width: 100%;
  }

  .flip-stage {
    min-height: 420px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-turning,
  .page-turn-shadow,
  .page-turn-gloss {
    animation-duration: 1ms !important;
  }
}
</style>
