<script setup lang="ts">
import type { ChoiceItem } from '../../content/types';
import type { Answer } from '../../domain/answers';

const props = defineProps<{
  item: ChoiceItem;
  modelValue: Answer | null;
  disabled?: boolean;
  /** 判分后揭示答案：正确项标绿、错选标红（订正重答阶段不传） */
  revealAnswer?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', answer: Answer | null): void;
}>();

const isSelected = (optionId: string): boolean =>
  props.modelValue?.kind === 'choice' && props.modelValue.optionId === optionId;

const optionState = (optionId: string): string => {
  if (!props.revealAnswer) return '';
  if (optionId === props.item.answerOptionId) return 'choice-option-answer';
  if (isSelected(optionId)) return 'choice-option-wrong';
  return '';
};

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
      :class="optionState(option.id)"
      :aria-pressed="isSelected(option.id)"
      :disabled="disabled"
      @click="select(option.id)"
    >
      {{ option.text }}<span
        v-if="revealAnswer && option.id === item.answerOptionId"
        aria-hidden="true"
      > ✓</span><span
        v-else-if="revealAnswer && isSelected(option.id)"
        aria-hidden="true"
      > ✗</span>
    </button>
  </div>
</template>
