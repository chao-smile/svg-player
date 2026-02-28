<template>
  <div ref="rootRef" class="flip-list">
    <div
      v-for="(item, index) in renderItems"
      :key="`st-page-${index}`"
      class="st-page"
      data-density="hard"
    >
      <slot :item="item" :index="index" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { PageFlip } from "page-flip";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

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

const rootRef = ref<HTMLElement | null>(null);
let pageFlip: PageFlip | null = null;
let syncingByCode = false;

const renderItems = computed(() => {
  if (props.items.length >= 2) return props.items;
  if (!props.items.length)
    return [{ __placeholder: "empty-1" }, { __placeholder: "empty-2" }];
  return [
    props.items[0],
    { ...props.items[0], id: `${props.items[0]?.id ?? "page"}-copy` },
  ];
});

const safeIndex = computed(() => {
  if (!renderItems.value.length) return 0;
  const idx = Math.trunc(props.activeIndex);
  if (idx < 0) return 0;
  if (idx >= renderItems.value.length) return renderItems.value.length - 1;
  return idx;
});

function initBook() {
  const root = rootRef.value;
  if (!root) return;

  pageFlip?.destroy();
  pageFlip = new PageFlip(root, {
    width: 980,
    height: 1380,
    size: "stretch",
    minWidth: 320,
    maxWidth: 1300,
    minHeight: 360,
    maxHeight: 1800,
    showCover: true,
    usePortrait: true,
    drawShadow: true,
    maxShadowOpacity: 0.48,
    mobileScrollSupport: false,
    useMouseEvents: false,
    disableFlipByClick: true,
    flippingTime: props.durationMs,
  });
  const pages = root.querySelectorAll(".st-page");
  pageFlip.loadFromHTML(pages);
  pageFlip.turnToPage(safeIndex.value);
}

async function reloadBook() {
  await nextTick();
  initBook();
}

function syncToIndex(index: number) {
  if (!pageFlip) return;
  const current = pageFlip.getCurrentPageIndex();
  if (current === index) return;
  syncingByCode = true;
  pageFlip.flip(index, "bottom");
  window.setTimeout(
    () => {
      syncingByCode = false;
    },
    Math.max(120, props.durationMs + 40),
  );
}

watch(
  () => renderItems.value.length,
  () => {
    void reloadBook();
  },
);

watch(
  safeIndex,
  (index) => {
    if (syncingByCode) return;
    syncToIndex(index);
  },
  { immediate: true },
);

watch(
  () => props.durationMs,
  () => {
    void reloadBook();
  },
);

onMounted(() => {
  initBook();
});

onBeforeUnmount(() => {
  pageFlip?.destroy();
  pageFlip = null;
});
</script>

<style scoped>
.flip-list {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  position: relative;
}

.st-page {
  background: #fff;
  overflow: hidden;
  border-radius: 12px;
  box-shadow:
    0 18px 42px rgba(15, 23, 42, 0.14),
    0 1px 0 rgba(15, 23, 42, 0.08);
}
</style>
