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
    durationMs: 460,
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
  perspective: 1200px;
}

.flip-page {
  transform-origin: center center;
  backface-visibility: hidden;
}

.flip-page-enter-active,
.flip-page-leave-active {
  transition:
    transform var(--flip-duration) cubic-bezier(0.22, 0.78, 0.28, 1),
    opacity var(--flip-duration) ease;
  will-change: transform, opacity;
}

.flip-page-enter-from {
  opacity: 0.22;
  transform: rotateX(76deg) scale(0.98);
}

.flip-page-leave-to {
  opacity: 0.1;
  transform: rotateX(-76deg) scale(0.98);
}
</style>
