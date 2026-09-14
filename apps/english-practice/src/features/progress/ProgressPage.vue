<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { db as defaultDb } from '../../data/db';
import { e2eNow } from '../../data/e2e-clock';
import type { GaokaoDatabase } from '../../data/db';
import type { WritingVersionBody } from '../../services/writing';
import { loadPersonalSettings, savePersonalSettings } from '../../services/settings';
import { summarizeProgress, SELF_EVAL_MIN, type ProgressAttempt, type ProgressInput, type ProgressWritingVersion } from '../../domain/progress';
import { pageToday } from '../../domain/progress';
import FeedbackPanel from '../../components/FeedbackPanel.vue';

const props = defineProps<{
  db?: GaokaoDatabase;
  // 测试缝：不传时按个人设置时区的学习日（与 attempt.studyDay 同口径）
  today?: string;
}>();

const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

const loading = ref(true);
const message = ref<string | null>(null);
const animationEnabled = ref(true);
const soundEnabled = ref(true);
const rewardVisible = ref(false);
const reducedMotion = ref(false);
const summaryText = ref<string[]>([]);
const nodeLines = ref<Array<{ titleZh: string; unlocked: boolean; achievementId: string }>>([]);
const seriesLines = ref<string[]>([]);
const cards = ref<Array<{ itemId: string; firstText: string; latestText: string; versionCount: number; checklistCount: number }>>([]);
const selfEvalLine = ref('');
const studyDayLine = ref('');
const unseenLine = ref('');
const rateLine = ref('');
const assistedLine = ref('');
const independentLine = ref('');

const parseVersionBody = (raw: string): WritingVersionBody | null => {
  try {
    return JSON.parse(raw) as WritingVersionBody;
  } catch {
    return null;
  }
};

const loadState = async (): Promise<void> => {
  loading.value = true;
  try {
    const settings = await loadPersonalSettings(db.value);
    animationEnabled.value = settings.animation;
    soundEnabled.value = settings.sound;
    try {
      reducedMotion.value = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
      reducedMotion.value = false;
    }
    const packs = (await db.value.packs.toArray()).filter((record) => record.status === 'installed' && record.resourcesReady);
    const units: ProgressInput['units'] = [];
    const itemIndex = new Map<string, { kind: ProgressAttempt['kind']; level: ProgressAttempt['level'] }>();
    const countedItems = new Set<string>();
    for (const record of packs) {
      const pack = record.pack as { id: string; units: Array<{ id: string; titleZh: string; itemIds: string[] }>; items: Array<{ id: string; kind: string; level: string }> };
      for (const unit of pack.units) units.push({ unitId: unit.id, titleZh: unit.titleZh });
      for (const item of pack.items) {
        itemIndex.set(item.id, { kind: item.kind as ProgressAttempt['kind'], level: item.level as ProgressAttempt['level'] });
        // 换版过渡期同一 (packId,itemId) 只计一次，避免未见题被重复条目稀释
        countedItems.add(pack.id + '|' + item.id);
      }
    }
    const totalItems = countedItems.size;
    // CR2：作答与曝光按当前 profile 过滤，跨 profile 不混算（旧数据无 profileId 字段视为同 profile）
    const exposures = (await db.value.exposures.toArray()).filter((exposure) => exposure.profileId === undefined || exposure.profileId === settings.profileId);
    const exposedItemIds = exposures.map((exposure) => exposure.itemId);
    // 与 submitAnswer 的曝光键同源：packId|packVersion|itemId（多包同 itemId 不互混）
    const firstSeen = new Map(exposures.map((exposure) => [exposure.packId + '|' + exposure.packVersion + '|' + exposure.itemId, exposure.firstSeenSessionId]));
    const achievementRows = (await db.value.achievements.toArray()).map((record) => ({ id: record.id, unlockedAt: record.unlockedAt }));
    const attemptRows = (await db.value.attempts.toArray()).filter((record) => record.profileId === undefined || record.profileId === settings.profileId).map((record): ProgressAttempt | null => {
      const payload = record.payload as { grade?: { earned: number; possible: number }; assistance?: string[]; ref?: { packId: string; packVersion: string; itemId: string }; phase?: string };
      const item = payload.ref ? itemIndex.get(payload.ref.itemId) : undefined;
      if (!payload.grade || !payload.ref || !item) return null;
      return {
        id: record.id,
        itemId: payload.ref.itemId,
        familyId: record.familyId,
        kind: item.kind,
        level: item.level,
        phase: record.phase === 'correction' ? 'correction' : 'first',
        studyDay: record.studyDay,
        createdAt: record.createdAt,
        gradeEarned: payload.grade.earned,
        gradePossible: payload.grade.possible,
        assisted: (payload.assistance ?? []).length > 0,
        firstSeenSelf: firstSeen.get(payload.ref.packId + '|' + payload.ref.packVersion + '|' + payload.ref.itemId) === record.sessionId,
      };
    });
    const validAttempts = attemptRows.filter((row): row is ProgressAttempt => row !== null);
    // 跨会话合并：版本号按 (sessionId,itemId) 重置，故按 createdAt 排序取初稿/最新，版本数=记录数
    const grouped = new Map<string, { createdAt: string; versionCount: number; checklistCount: number; firstText: string; latestText: string }>();
    for (const record of await db.value.writingVersions.toArray()) {
      const body = parseVersionBody(record.content);
      const existing = grouped.get(record.itemId);
      const isFirst = existing === undefined || record.createdAt < existing.createdAt;
      const isLatest = existing === undefined || record.createdAt >= existing.createdAt;
      grouped.set(record.itemId, {
        createdAt: isFirst ? record.createdAt : existing!.createdAt,
        versionCount: (existing?.versionCount ?? 0) + 1,
        checklistCount: (existing?.checklistCount ?? 0) + (body?.checklist?.length ?? 0),
        firstText: isFirst ? body?.content ?? '' : existing!.firstText,
        latestText: isLatest ? body?.content ?? existing!.latestText : existing!.latestText,
      });
    }
    const writingVersions: ProgressWritingVersion[] = [...grouped.entries()].map(([itemId, group]) => ({
      itemId,
      createdAt: group.createdAt,
      versionCount: group.versionCount,
      checklistCount: group.checklistCount,
      firstText: group.firstText,
      latestText: group.latestText,
    }));
    const summary = summarizeProgress({
      today: props.today ?? pageToday(e2eNow(), settings.timeZone),
      attempts: validAttempts,
      totalItems,
      exposedItemIds,
      units,
      achievements: achievementRows,
      writingVersions,
    });
    rateLine.value = '独立首次正确率 ' + Math.round(summary.objective.rate * 100) + '%（' + summary.objective.correct + '/' + summary.objective.attempts + '）';
    assistedLine.value = '提示后完成 ' + summary.assistedCompletions + ' 题（不计入独立口径）';
    independentLine.value = '独立掌握题目 ' + summary.independentItems + ' 题 · 发现家族 ' + summary.discoveredFamilies + ' 个';
    studyDayLine.value = '累计学习日 ' + summary.studyDays.length + ' 天' + (summary.todayMarked ? ' · 今日已标记' : '');
    unseenLine.value = '未见题 ' + summary.unseenCount + ' 题';
    nodeLines.value = summary.mapNodes.map((node) => ({ titleZh: node.titleZh, unlocked: node.unlocked, achievementId: node.achievementId }));
    seriesLines.value = summary.series.map((serie) => {
      const label = serie.kind + ' · ' + serie.level;
      return label + '：本周 ' + serie.thisWeek.correct + '/' + serie.thisWeek.attempts + '，前期 ' + serie.earlier.correct + '/' + serie.earlier.attempts;
    });
    cards.value = summary.writingCards.map((card) => ({
      itemId: card.itemId,
      firstText: card.firstText,
      latestText: card.latestText,
      versionCount: card.versionCount,
      checklistCount: card.checklistCount,
    }));
    selfEvalLine.value = summary.selfEvalFormal
      ? '自评样本 ' + summary.selfEvalSamples + '（已达样本阈值，仅作自评参考）'
      : '自评样本 ' + summary.selfEvalSamples + '/' + SELF_EVAL_MIN + '，暂不算正式能力等级';
    summaryText.value = [rateLine.value, assistedLine.value, independentLine.value, studyDayLine.value, unseenLine.value];
    rewardVisible.value = animationEnabled.value && !reducedMotion.value && summary.todayMarked;
  } catch {
    message.value = '成长记录读取失败，请稍后再试';
  } finally {
    loading.value = false;
  }
};

onMounted(loadState);

const toggleAnimation = async (): Promise<void> => {
  try {
    const settings = await loadPersonalSettings(db.value);
    const next = { ...settings, animation: !settings.animation };
    await savePersonalSettings(db.value, next);
    animationEnabled.value = next.animation;
    rewardVisible.value = next.animation && !reducedMotion.value && rewardVisible.value;
  } catch {
    message.value = '设置保存失败，请稍后再试';
  }
};

const toggleSound = async (): Promise<void> => {
  try {
    const settings = await loadPersonalSettings(db.value);
    await savePersonalSettings(db.value, { ...settings, sound: !settings.sound });
    soundEnabled.value = !settings.sound;
  } catch {
    message.value = '设置保存失败，请稍后再试';
  }
};

const closeReward = (): void => {
  rewardVisible.value = false;
};
</script>

<template>
  <section
    class="progress-page"
    aria-labelledby="progress-title"
  >
    <h2 id="progress-title">
      成长记录
    </h2>
    <p
      v-if="loading"
      role="status"
    >
      正在统计学习记录…
    </p>
    <template v-else>
      <p
        v-if="message !== null"
        role="alert"
      >
        {{ message }}
      </p>
      <FeedbackPanel
        :status="'saved'"
        :message="null"
        :reward="{ enabled: rewardVisible, reduced: reducedMotion }"
        @close-reward="closeReward"
      />
      <ul
        class="progress-summary"
        aria-label="总体进度"
      >
        <li
          v-for="line in summaryText"
          :key="line"
        >
          {{ line }}
        </li>
      </ul>

      <h3>学习地图</h3>
      <ul
        class="progress-map"
        aria-label="学习地图"
      >
        <li
          v-for="node in nodeLines"
          :key="node.achievementId"
        >
          {{ node.titleZh }} · {{ node.unlocked ? '已解锁' : '未解锁' }}
        </li>
      </ul>

      <h3>可比较任务（按题型与层级分开）</h3>
      <p
        v-if="seriesLines.length === 0"
        role="status"
      >
        暂无可比较的任务样本。
      </p>
      <ul
        v-else
        class="progress-series"
        aria-label="可比较任务"
      >
        <li
          v-for="line in seriesLines"
          :key="line"
        >
          {{ line }}
        </li>
      </ul>

      <h3>作品卡</h3>
      <p
        v-if="cards.length === 0"
        role="status"
      >
        暂无写作作品卡。
      </p>
      <ul
        v-else
        class="progress-cards"
        aria-label="作品卡"
      >
        <li
          v-for="card in cards"
          :key="card.itemId"
          class="writing-card"
        >
          <p>初稿：{{ card.firstText }}</p>
          <p>修改稿：{{ card.latestText }}</p>
          <p>共 {{ card.versionCount }} 个版本 · 自评项 {{ card.checklistCount }} 项</p>
        </li>
      </ul>
      <p>{{ selfEvalLine }}</p>

      <button
        type="button"
        class="animation-toggle"
        @click="toggleAnimation"
      >
        {{ animationEnabled ? '关闭动画' : '开启动画' }}
      </button>
      <button
        type="button"
        class="sound-toggle"
        @click="toggleSound"
      >
        {{ soundEnabled ? '关闭音效' : '开启音效' }}
      </button>
      <p>
        <router-link to="/today">返回今日</router-link>
      </p>
    </template>
  </section>
</template>
