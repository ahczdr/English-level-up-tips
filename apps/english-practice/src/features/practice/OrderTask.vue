<script setup lang="ts">
import { computed } from 'vue';
import type { OrderItem } from '../../content/types';
import type { Answer } from '../../domain/answers';

const props = defineProps<{
  item: OrderItem;
  modelValue: Answer | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', answer: Answer | null): void;
}>();

const selectedIds = computed<string[]>(() =>
  props.modelValue?.kind === 'order' ? [...props.modelValue.tokenIds] : [],
);

const poolTokens = computed(() =>
  props.item.tokens.filter((token) => !selectedIds.value.includes(token.id)),
);

const tokenText = (tokenId: string): string =>
  props.item.tokens.find((token) => token.id === tokenId)?.text ?? tokenId;

const emitIds = (ids: string[]): void => {
  emit('update:modelValue', { kind: 'order', tokenIds: ids });
};

const appendToken = (tokenId: string): void => {
  if (props.disabled || selectedIds.value.includes(tokenId)) return;
  emitIds([...selectedIds.value, tokenId]);
};

const removeAt = (index: number): void => {
  if (props.disabled) return;
  const ids = [...selectedIds.value];
  ids.splice(index, 1);
  emitIds(ids);
};

const move = (from: number, to: number): void => {
  if (props.disabled || to < 0 || to >= selectedIds.value.length) return;
  const ids = [...selectedIds.value];
  const [tokenId] = ids.splice(from, 1);
  ids.splice(to, 0, tokenId);
  emitIds(ids);
};
</script>

<template>
  <div class="order-task">
    <div
      class="token-sequence"
      aria-label="已排序词块"
    >
      <div
        v-for="(tokenId, index) in selectedIds"
        :key="tokenId"
        class="token-chip"
      >
        <button
          type="button"
          class="token-word"
          :disabled="disabled"
          @click="removeAt(index)"
        >
          {{ tokenText(tokenId) }}
        </button>
        <button
          type="button"
          class="token-move token-move-left"
          :disabled="disabled || index === 0"
          @click="move(index, index - 1)"
        >
          左移
        </button>
        <button
          type="button"
          class="token-move token-move-right"
          :disabled="disabled || index === selectedIds.length - 1"
          @click="move(index, index + 1)"
        >
          右移
        </button>
      </div>
    </div>
    <div
      class="token-pool"
      aria-label="待排序词块"
    >
      <button
        v-for="token in poolTokens"
        :key="token.id"
        type="button"
        class="token-option"
        :disabled="disabled"
        @click="appendToken(token.id)"
      >
        {{ token.text }}
      </button>
    </div>
  </div>
</template>
