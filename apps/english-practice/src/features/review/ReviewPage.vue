<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { db as defaultDb } from '../../data/db';
import { e2eNow } from '../../data/e2e-clock';
import type { GaokaoDatabase } from '../../data/db';
import { studyDayFor } from '../../domain/calendar';
import { loadPersonalSettings } from '../../services/settings';

const props = defineProps<{
  db?: GaokaoDatabase;
}>();

const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

interface ReviewRow {
  familyId: string;
  reviewMode: string;
  dueDay: string;
  stage: number;
  lapses: number;
  due: boolean;
}

const rows = ref<ReviewRow[]>([]);
const loading = ref(true);

const loadState = async (): Promise<void> => {
  loading.value = true;
  try {
    // T14/B1：走 E2E 时钟桥默认实现（生产构建 e2eNow ≡ new Date()），复习到期判定与计划链路一致
    const today = studyDayFor(e2eNow());
    const settings = await loadPersonalSettings(db.value);
    const records = await db.value.reviewStates.toArray();
    rows.value = records
      .filter((record) => record.profileId === settings.profileId)
      .map((record) => {
        const state = record.data as { stage?: number; lapses?: number } | null;
        return {
          familyId: record.familyId,
          reviewMode: record.reviewMode,
          dueDay: record.dueDay,
          stage: typeof state?.stage === 'number' ? state.stage : 0,
          lapses: typeof state?.lapses === 'number' ? state.lapses : 0,
          due: record.dueDay <= today,
        };
      })
      .sort((left, right) => (left.dueDay === right.dueDay ? 0 : left.dueDay < right.dueDay ? -1 : 1));
  } catch {
    rows.value = [];
  } finally {
    loading.value = false;
  }
};

onMounted(loadState);
</script>

<template>
  <section
    class="review-page"
    aria-labelledby="review-title"
  >
    <h2 id="review-title">
      复习列表
    </h2>
    <p
      v-if="loading"
      role="status"
    >
      正在读取复习计划…
    </p>
    <p
      v-else-if="rows.length === 0"
      role="status"
    >
      暂无到期复习
    </p>
    <ul
      v-else
      class="review-list"
    >
      <li
        v-for="row in rows"
        :key="row.familyId + row.reviewMode"
        class="review-row"
      >
        <span class="review-family">{{ row.familyId }}</span>
        <span class="review-mode">{{ row.reviewMode }}</span>
        <span class="review-due">{{ row.dueDay }}</span>
        <span
          class="review-status"
          :class="{ overdue: row.due }"
        >{{ row.due ? '已到期' : '未到期' }}</span>
      </li>
    </ul>
    <p>
      <router-link to="/today">返回今日</router-link>
    </p>
  </section>
</template>
