<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Gap, GapsItem } from '../../content/types';
import type { Answer } from '../../domain/answers';
import AppButton from '../../components/AppButton.vue';

interface PendingMove {
  optionId: string;
  fromGapId: string;
  toGapId: string;
}

const props = defineProps<{
  item: GapsItem;
  modelValue: Answer | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', answer: Answer | null): void;
}>();

const values = computed<Record<string, string>>(() =>
  props.modelValue?.kind === 'gaps' ? { ...props.modelValue.values } : {},
);

const activeGapId = ref<string | null>(null);

const gapById = (gapId: string): Gap | undefined =>
  props.item.gaps.find((gap) => gap.id === gapId);

const activeGap = computed<Gap | null>(() => gapById(activeGapId.value ?? '') ?? null);

const optionsForActiveGap = computed(() => {
  const gap = activeGap.value;
  if (!gap) return [];
  return props.item.sharedOptions.length > 0 ? props.item.sharedOptions : gap.options;
});

const optionText = (gapId: string, optionId: string): string => {
  const gap = gapById(gapId);
  const pool = props.item.sharedOptions.length > 0 ? props.item.sharedOptions : gap?.options ?? [];
  return pool.find((option) => option.id === optionId)?.text ?? optionId;
};

const usedOptionIds = computed(() => new Set(Object.values(values.value)));

const emitValues = (next: Record<string, string>): void => {
  emit('update:modelValue', { kind: 'gaps', values: next });
};

// T07：text 模式软键盘 Next/Enter 只移动焦点到下一空输入框，不触发提交
interface Focusable {
  focus?: () => void;
}

const inputRefs = new Map<string, Focusable>();

const setInputRef = (gapId: string, element: unknown): void => {
  if (element) inputRefs.set(gapId, element as Focusable);
  else inputRefs.delete(gapId);
};

const focusNextGap = (currentGapId: string): void => {
  const gapIds = props.item.segments
    .filter((segment) => segment.type === 'gap')
    .map((segment) => segment.gapId);
  const nextGapId = gapIds[gapIds.indexOf(currentGapId) + 1];
  if (!nextGapId) return;
  inputRefs.get(nextGapId)?.focus?.();
};

// uniqueOptions 下指示某选项当前被哪个空占用（不产生重复占用的关键）
const gapUsingOption = (optionId: string): Gap | undefined =>
  props.item.gaps.find((gap) => values.value[gap.id] === optionId);

const moveConfirm = ref<PendingMove | null>(null);

const moveConfirmText = computed(() => {
  const pending = moveConfirm.value;
  if (!pending) return '';
  const fromLabel = gapById(pending.fromGapId)?.label ?? '?';
  const toLabel = gapById(pending.toGapId)?.label ?? '?';
  return `把「${optionText(pending.fromGapId, pending.optionId)}」从第 ${fromLabel} 空移动到第 ${toLabel} 空？`;
});

const chooseOption = (gapId: string, optionId: string): void => {
  if (props.disabled) return;
  if (values.value[gapId] === optionId) return;
  const canReuse = props.item.inputMode === 'options' && props.item.uniqueOptions;
  const fromGap = canReuse ? gapUsingOption(optionId) : undefined;
  if (fromGap && fromGap.id !== gapId) {
    // 已被其他空占用：提供移动确认，确认后原空清空，绝不同时占用两空
    moveConfirm.value = { optionId, fromGapId: fromGap.id, toGapId: gapId };
    return;
  }
  moveConfirm.value = null;
  emitValues({ ...values.value, [gapId]: optionId });
};

const confirmMove = (): void => {
  const pending = moveConfirm.value;
  if (!pending || props.disabled) return;
  const next = { ...values.value };
  delete next[pending.fromGapId];
  next[pending.toGapId] = pending.optionId;
  moveConfirm.value = null;
  emitValues(next);
};

const cancelMove = (): void => {
  moveConfirm.value = null;
};

const clearActiveGap = (): void => {
  if (props.disabled || activeGapId.value === null) return;
  const next = { ...values.value };
  delete next[activeGapId.value];
  emitValues(next);
};

// 用 unknown + 运行时窄化代替 Event/HTMLInputElement 全局类型，兼容当前 eslint 配置
const inputGapValue = (gapId: string, event: unknown): void => {
  if (props.disabled) return;
  const target = (event as { target?: { value?: unknown } }).target;
  if (typeof target?.value !== 'string') return;
  emitValues({ ...values.value, [gapId]: target.value });
};
</script>

<template>
  <div class="gap-task">
    <p class="gap-sentence">
      <template
        v-for="(segment, index) in item.segments"
        :key="index"
      >
        <span
          v-if="segment.type === 'text'"
          class="gap-text"
        >{{ segment.text }}</span>
        <template v-else-if="item.inputMode === 'options'">
          <button
            type="button"
            class="gap-slot"
            :class="{ 'gap-slot-active': activeGapId === segment.gapId }"
            :disabled="disabled"
            :aria-label="`选择第 ${gapById(segment.gapId)?.label ?? '?'} 空的答案`"
            @click="activeGapId = segment.gapId"
          >
            {{ values[segment.gapId] ? optionText(segment.gapId, values[segment.gapId]) : `第 ${gapById(segment.gapId)?.label ?? '?'} 空` }}
          </button>
        </template>
        <template v-else>
          <span class="gap-clue">提示词：{{ gapById(segment.gapId)?.clue ?? '' }}</span>
          <input
            :ref="(element) => setInputRef(segment.gapId, element)"
            class="gap-input"
            type="text"
            :value="values[segment.gapId] ?? ''"
            :disabled="disabled"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint="next"
            :aria-label="`填写第 ${gapById(segment.gapId)?.label ?? '?'} 空`"
            @input="inputGapValue(segment.gapId, $event)"
            @keydown.enter.prevent="focusNextGap(segment.gapId)"
          >
        </template>
      </template>
    </p>
    <div
      v-if="item.inputMode === 'options' && activeGap"
      class="gap-options"
      aria-label="当前空位选项"
    >
      <button
        v-for="option in optionsForActiveGap"
        :key="option.id"
        type="button"
        class="gap-option"
        :class="{ 'gap-option-is-used': item.uniqueOptions && usedOptionIds.has(option.id) && values[activeGap.id] !== option.id }"
        :disabled="disabled"
        @click="chooseOption(activeGap.id, option.id)"
      >
        {{ option.text }}
        <span
          v-if="item.uniqueOptions && usedOptionIds.has(option.id) && values[activeGap.id] !== option.id"
          class="gap-option-used"
        >
          已用于第 {{ gapUsingOption(option.id)?.label ?? '?' }} 空
        </span>
      </button>
      <button
        type="button"
        class="gap-clear"
        :disabled="disabled"
        @click="clearActiveGap"
      >
        清除本空
      </button>
    </div>
    <div
      v-if="moveConfirm !== null"
      class="gap-move-confirm"
      role="alertdialog"
      aria-label="确认移动"
    >
      <p>{{ moveConfirmText }}</p>
      <div class="confirm-actions">
        <AppButton @click="confirmMove">
          确认移动
        </AppButton>
        <AppButton
          variant="ghost"
          @click="cancelMove"
        >
          取消
        </AppButton>
      </div>
    </div>
  </div>
</template>
