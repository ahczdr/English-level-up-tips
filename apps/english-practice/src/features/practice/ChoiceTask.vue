<script setup lang="ts">
import type { ChoiceItem } from '../../content/types';
import type { Answer } from '../../domain/answers';

const props = defineProps<{
  item: ChoiceItem;
  modelValue: Answer | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', answer: Answer | null): void;
}>();

const isSelected = (optionId: string): boolean =>
  props.modelValue?.kind === 'choice' && props.modelValue.optionId === optionId;

const select = (optionId: string): void => {
  if (props.disabled) return;
  emit('update:modelValue', { kind: 'choice', optionId });
};
</script>

<template>
  <div
    class="choice-task"
    role="group"
    aria-label="答题选项"
  >
    <button
      v-for="option in item.options"
      :key="option.id"
      type="button"
      class="choice-option"
      :aria-pressed="isSelected(option.id)"
      :disabled="disabled"
      @click="select(option.id)"
      @keydown.enter="select(option.id)"
      @keydown.space="select(option.id)"
    >
      {{ option.text }}
    </button>
  </div>
</template>
