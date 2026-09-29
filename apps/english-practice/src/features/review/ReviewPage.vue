<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { db as defaultDb } from '../../data/db';
import { e2eNow } from '../../data/e2e-clock';
import type { GaokaoDatabase } from '../../data/db';
import type { CoursePack } from '../../content/types';
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
  labelZh: string;
  sectionZh: string;
  modeZh: string;
}

const MODE_LABELS: Record<string, string> = { recognition: '再认', recall: '回忆', transfer: '迁移' };
const SECTION_LABELS: Record<string, string> = {
  vocabulary: '词汇', sentence: '句子', reading: '阅读', 'gap-reading': '七选五', cloze: '完形',
  grammar: '语法填空', listening: '听力', 'application-writing': '应用文', continuation: '读后续写',
};

const rows = ref<ReviewRow[]>([]);
const loading = ref(true);
const loadFailed = ref(false);

// CR7：familyId → 学生可读标签（单元名 + 题型），从已安装包反查；找不到时回退原始 id
const buildFamilyLabels = async (): Promise<Map<string, { labelZh: string; sectionZh: string }>> => {
  const labels = new Map<string, { labelZh: string; sectionZh: string }>();
  const records = (await db.value.packs.toArray()).filter((record) => record.status === 'installed');
  for (const record of records) {
    const pack = record.pack as CoursePack;
    if (!Array.isArray(pack?.items) || !Array.isArray(pack?.units)) continue;
    for (const unit of pack.units) {
      for (const itemId of unit.itemIds) {
        const item = pack.items.find((candidate) => candidate.id === itemId);
        if (!item || labels.has(item.familyId)) continue;
        labels.set(item.familyId, {
          labelZh: unit.titleZh,
          sectionZh: SECTION_LABELS[item.section] ?? item.section,
        });
      }
    }
  }
  return labels;
};

const loadState = async (): Promise<void> => {
  loading.value = true;
  loadFailed.value = false;
  try {
    const settings = await loadPersonalSettings(db.value);
    // T14/B1：走 E2E 时钟桥默认实现，并沿用个人设置时区，和计划/成长记录保持一致
    const today = studyDayFor(e2eNow(), settings.timeZone);
    const [labels, records] = await Promise.all([
      buildFamilyLabels(),
      db.value.reviewStates.where('profileId').equals(settings.profileId).toArray(),
    ]);
    rows.value = records
      .map((record) => {
        const state = record.data as { stage?: number; lapses?: number } | null;
        const label = labels.get(record.familyId);
        return {
          familyId: record.familyId,
          reviewMode: record.reviewMode,
          dueDay: record.dueDay,
          stage: typeof state?.stage === 'number' ? state.stage : 0,
          lapses: typeof state?.lapses === 'number' ? state.lapses : 0,
          due: record.dueDay <= today,
          labelZh: label?.labelZh ?? record.familyId,
          sectionZh: label?.sectionZh ?? '',
          modeZh: MODE_LABELS[record.reviewMode] ?? record.reviewMode,
        };
      })
      .sort((left, right) => (left.dueDay === right.dueDay ? 0 : left.dueDay < right.dueDay ? -1 : 1));
  } catch {
    // CR39：读取失败与空态分开呈现
    rows.value = [];
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
};

const dueCount = computed(() => rows.value.filter((row) => row.due).length);

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
    <template v-else-if="loadFailed">
      <p
        role="alert"
        class="review-error"
      >
        复习计划读取失败，请重试。
      </p>
      <button
        type="button"
        class="review-retry"
        @click="loadState"
      >
        重新加载
      </button>
    </template>
    <p
      v-else-if="rows.length === 0"
      role="status"
    >
      暂无到期复习
    </p>
    <template v-else>
      <p
        v-if="dueCount > 0"
        class="review-cta"
        role="status"
      >
        有 {{ dueCount }} 个家族已到期——复习会自动排进今日计划的优先位置。
        <router-link
          class="review-cta-link"
          to="/today"
        >开始今日计划</router-link>
      </p>
      <ul
        v-else
        class="review-cta"
        role="status"
      >
        <li>当前没有到期复习；到期后会自动排进今日计划。</li>
      </ul>
      <ul
        v-if="rows.length > 0"
        class="review-list"
      >
        <li
          v-for="row in rows"
          :key="row.familyId + row.reviewMode"
          class="review-row"
        >
          <span class="review-family">{{ row.labelZh }}</span>
          <span class="review-mode">{{ row.sectionZh }} · {{ row.modeZh }}</span>
          <span class="review-due">{{ row.dueDay }}</span>
          <span
            class="review-status"
            :class="{ overdue: row.due }"
          >{{ row.due ? '已到期' : '未到期' }}</span>
        </li>
      </ul>
    </template>
    <p>
      <router-link to="/today">返回今日</router-link>
    </p>
  </section>
</template>
