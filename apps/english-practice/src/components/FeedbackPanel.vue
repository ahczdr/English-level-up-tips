<script setup lang="ts">
import { ref } from 'vue';
import type { Evidence, Item } from '../content/types';
import type { Attempt } from '../services/learning';

const props = defineProps<{
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string | null;
  attempt?: Attempt | null;
  item?: Item | null;
  // T11/P06：奖励动效 ≤600ms、可关闭；关闭动画或系统减少动画时不渲染
  reward?: { enabled: boolean; reduced: boolean } | null;
}>();

const rewardDismissed = ref(false);

// 提交后点击证据跳转原文对应段落（阅读材料高亮由上层处理）
const emit = defineEmits<{
  (event: 'jump', evidence: Evidence): void;
  (event: 'close-reward'): void;
}>();

const gradeText = (): string => {
  const attempt = props.attempt;
  if (!attempt) return '';
  if (attempt.phase === 'correction') return '订正已保存';
  if (attempt.grade.possible > 0 && attempt.grade.earned === attempt.grade.possible) return '回答正确';
  if (attempt.grade.earned > 0) return '部分正确';
  return '回答有误';
};

const gapResults = (): Array<{ label: string; correct: boolean }> => {
  const attempt = props.attempt;
  const item = props.item;
  if (!attempt || !item || item.kind !== 'gaps') return [];
  return item.gaps.map((gap) => ({
    label: `第 ${gap.label} 空`,
    correct: attempt.grade.perGap[gap.id] === true,
  }));
};
</script>

<style scoped>
.reward-flash {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff7e0;
  border: 1px solid #f0c948;
  animation: reward-pop 0.6s ease-out both;
}
@keyframes reward-pop {
  from {
    transform: scale(0.96);
    opacity: 0.4;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .reward-flash {
    animation: none;
  }
}
</style>

<template>
  <section
    class="feedback-panel"
    aria-label="提交反馈"
  >
    <div
      v-if="reward !== null && reward !== undefined && reward.enabled && !reward.reduced && !rewardDismissed"
      class="reward-flash"
      role="note"
      aria-label="奖励"
    >
      <span>今日任务完成，学习日已标记！</span>
      <button
        type="button"
        class="reward-close"
        @click="rewardDismissed = true; emit('close-reward')"
      >
        关闭
      </button>
    </div>
    <p
      v-if="status === 'saving'"
      role="status"
      class="feedback-state"
    >
      保存中…
    </p>
    <p
      v-else-if="status === 'error'"
      role="alert"
      class="feedback-error"
    >
      {{ message ?? '保存失败，请重试' }}
    </p>
    <template v-else-if="status === 'saved'">
      <p
        role="status"
        class="feedback-state"
      >
        {{ message ?? '已保存' }}
      </p>
      <p
        v-if="attempt"
        class="feedback-grade"
      >
        {{ gradeText() }}
      </p>
      <ul
        v-if="gapResults().length > 0"
        class="gap-results"
      >
        <li
          v-for="result in gapResults()"
          :key="result.label"
          class="gap-result"
          :class="result.correct ? 'gap-result-correct' : 'gap-result-wrong'"
        >
          {{ result.label }}：{{ result.correct ? '对' : '错' }}
        </li>
      </ul>
      <div
        v-if="item"
        class="feedback-explanation"
      >
        <p>{{ item.explanation.summaryZh }}</p>
        <p>{{ item.explanation.ruleZh }}</p>
        <ul
          v-if="item.explanation.distractors.length > 0"
          class="feedback-distractors"
        >
          <li
            v-for="distractor in item.explanation.distractors"
            :key="distractor.optionId"
          >
            {{ distractor.reasonZh }}
          </li>
        </ul>
        <button
          v-for="evidence in item.explanation.evidence"
          :key="evidence.paragraphId"
          type="button"
          class="feedback-evidence"
          @click="emit('jump', evidence)"
        >
          查看依据：{{ evidence.quote }}
        </button>
      </div>
    </template>
  </section>
</template>
