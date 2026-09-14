<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Evidence, Resource } from '../content/types';

const props = defineProps<{
  resource: Resource;
  highlights: Evidence[];
}>();

const root = ref<{ querySelector?: (selector: string) => unknown } | null>(null);

const highlightFor = (paragraphId: string): Evidence | undefined =>
  props.highlights.find((evidence) => evidence.paragraphId === paragraphId);

// 将段落文本按 quote 定位拆段，用 mark 包裹命中片段；原文字符串本身不改动
const pieces = computed(() => {
  return props.resource.paragraphs.map((paragraph) => {
    const evidence = highlightFor(paragraph.id);
    const quote = evidence?.quote ?? '';
    if (!evidence || quote === '') {
      return [{ text: paragraph.text, highlight: false }];
    }
    const index = paragraph.text.indexOf(quote);
    if (index < 0) return [{ text: paragraph.text, highlight: false }];
    return [
      { text: paragraph.text.slice(0, index), highlight: false },
      { text: quote, highlight: true },
      { text: paragraph.text.slice(index + quote.length), highlight: false },
    ];
  });
});

interface ScrollableElement {
  scrollIntoView?: (options: { block: string; behavior: 'auto' | 'instant' | 'smooth' }) => void;
}

const scrollToParagraph = (paragraphId: string): void => {
  const element = root.value?.querySelector?.(`[data-paragraph-id="${paragraphId}"]`) as ScrollableElement | null;
  element?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
};

defineExpose({ scrollToParagraph });
</script>

<template>
  <div
    ref="root"
    class="passage"
    aria-label="阅读材料"
  >
    <p
      v-for="(paragraph, paragraphIndex) in resource.paragraphs"
      :key="paragraph.id"
      :data-paragraph-id="paragraph.id"
      class="passage-paragraph"
    >
      <template
        v-for="(piece, pieceIndex) in pieces[paragraphIndex]"
        :key="pieceIndex"
      >
        <mark
          v-if="piece.highlight"
          class="passage-highlight"
        >{{ piece.text }}</mark>
        <template v-else>
          {{ piece.text }}
        </template>
      </template>
    </p>
  </div>
</template>
