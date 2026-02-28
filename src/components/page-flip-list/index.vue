<template>
  <div class="flip-list" :style="flipVars">
    <transition name="flip-page" mode="out-in">
      <div :key="`page-${safeIndex}`" class="flip-page">
        <slot :item="activeItem" :index="safeIndex" />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    items: unknown[];
    activeIndex: number;
    durationMs?: number;
  }>(),
  {
    durationMs: 760,
  },
);

const safeIndex = computed(() => {
  if (!props.items.length) return 0;
  const idx = Math.trunc(props.activeIndex);
  if (idx < 0) return 0;
  if (idx >= props.items.length) return props.items.length - 1;
  return idx;
});

const activeItem = computed(() => props.items[safeIndex.value] ?? null);

const flipVars = computed(() => ({
  "--flip-duration": `${props.durationMs}ms`,
}));
</script>

<style scoped>
.flip-list {
  perspective: 2200px;
  transform-style: preserve-3d;
  position: relative;
}

.flip-page {
  transform-origin: right bottom;
  backface-visibility: hidden;
  transform-style: preserve-3d;
  position: relative;
}

.flip-page::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(0, 0, 0, 0) 62%,
    rgba(0, 0, 0, 0.08) 76%,
    rgba(0, 0, 0, 0.16) 100%
  );
  opacity: 0;
}

.flip-page-enter-active,
.flip-page-leave-active {
  transition:
    transform var(--flip-duration) cubic-bezier(0.18, 0.82, 0.24, 1),
    opacity var(--flip-duration) ease-out,
    filter var(--flip-duration) ease-out;
  will-change: transform, opacity, filter;
}

.flip-page-enter-active::after,
.flip-page-leave-active::after {
  transition: opacity var(--flip-duration) ease;
}

.flip-page-enter-from {
  opacity: 0;
  transform: rotateY(84deg) rotateX(-8deg) scale(0.99);
  filter: brightness(0.94);
}

.flip-page-enter-active::after {
  opacity: 0.2;
}

.flip-page-leave-to {
  opacity: 0.04;
  transform: rotateY(-84deg) rotateX(8deg) scale(0.99);
  filter: brightness(0.9);
}

.flip-page-leave-active::after {
  opacity: 0.32;
}
</style>
