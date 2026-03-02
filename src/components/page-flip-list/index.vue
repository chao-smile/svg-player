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
  max-width: 860px;
  margin: 0 auto;
}

.flip-stage {
  width: 100%;
  aspect-ratio: 31 / 45;
  min-height: clamp(420px, 68vw, 920px);
  margin: 0 auto;
  perspective: 2000px;
  perspective-origin: 90% 92%;
  position: relative;
  overflow: hidden;
}

.flip-stage::before {
  content: "";
  position: absolute;
  inset: auto 2% 1.2% 2%;
  height: 5%;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.16) 0%,
    rgba(15, 23, 42, 0.04) 65%,
    rgba(15, 23, 42, 0) 100%
  );
  filter: blur(10px);
}

.page {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 14px;
  background: #fff;
  box-shadow:
    0 26px 46px rgba(15, 23, 42, 0.16),
    0 1px 0 rgba(15, 23, 42, 0.08);
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
  animation: peel-forward var(--flip-duration) cubic-bezier(0.24, 0.82, 0.24, 1)
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
    320deg,
    rgba(0, 0, 0, 0.28) 0%,
    rgba(0, 0, 0, 0.14) 12%,
    rgba(0, 0, 0, 0) 34%
  );
  mix-blend-mode: multiply;
  animation: shadow-fade var(--flip-duration) ease both;
}

.page-turn-gloss {
  position: absolute;
  right: -12%;
  bottom: -12%;
  width: 62%;
  height: 62%;
  pointer-events: none;
  border-radius: 44% 56% 60% 40%;
  background: radial-gradient(
    circle at 8% 92%,
    rgba(255, 255, 255, 0.8) 0%,
    rgba(255, 255, 255, 0.28) 24%,
    rgba(255, 255, 255, 0) 70%
  );
  filter: blur(0.4px);
  animation: gloss-trace var(--flip-duration) ease both;
}

@keyframes peel-forward {
  0% {
    opacity: 1;
    transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate(0, 0) scale(1);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
    filter: brightness(1);
  }
  22% {
    transform: rotateX(0deg) rotateY(-3deg) rotateZ(1.1deg) translate(0.3%, 0.8%)
      scale(0.998);
    clip-path: polygon(0 0, 100% 0, 100% 90%, 95% 100%, 0 100%);
  }
  48% {
    transform: rotateX(2.4deg) rotateY(-11deg) rotateZ(2.3deg)
      translate(2.8%, 4.6%) scale(0.992);
    clip-path: polygon(0 0, 100% 0, 100% 76%, 86% 100%, 0 100%);
  }
  74% {
    transform: rotateX(5.5deg) rotateY(-25deg) rotateZ(4.6deg)
      translate(10%, 13.5%) scale(0.975);
    clip-path: polygon(0 0, 100% 0, 100% 38%, 58% 100%, 0 100%);
  }
  100% {
    opacity: 0;
    transform: rotateX(10deg) rotateY(-48deg) rotateZ(8.5deg)
      translate(26%, 20%) scale(0.93);
    clip-path: polygon(0 0, 100% 0, 100% 0, 24% 100%, 0 100%);
    filter: brightness(0.9);
  }
}

@keyframes peel-backward {
  0% {
    opacity: 1;
    transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg) translate(0, 0) scale(1);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
    filter: brightness(1);
  }
  22% {
    transform: rotateX(0deg) rotateY(3deg) rotateZ(-1.1deg)
      translate(-0.3%, 0.8%) scale(0.998);
    clip-path: polygon(0 0, 100% 0, 5% 100%, 0 90%);
  }
  48% {
    transform: rotateX(2.4deg) rotateY(11deg) rotateZ(-2.3deg)
      translate(-2.8%, 4.6%) scale(0.992);
    clip-path: polygon(0 0, 100% 0, 14% 100%, 0 76%);
  }
  74% {
    transform: rotateX(5.5deg) rotateY(25deg) rotateZ(-4.6deg)
      translate(-10%, 13.5%) scale(0.975);
    clip-path: polygon(0 0, 100% 0, 42% 100%, 0 38%);
  }
  100% {
    opacity: 0;
    transform: rotateX(10deg) rotateY(48deg) rotateZ(-8.5deg)
      translate(-26%, 20%) scale(0.93);
    clip-path: polygon(0 0, 100% 0, 76% 100%, 0 0);
    filter: brightness(0.9);
  }
}

@keyframes shadow-fade {
  0% {
    opacity: 0.02;
  }
  42% {
    opacity: 0.52;
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
  40% {
    opacity: 0.76;
  }
  100% {
    opacity: 0;
    transform: rotate(14deg) translate(-12%, -12%);
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
