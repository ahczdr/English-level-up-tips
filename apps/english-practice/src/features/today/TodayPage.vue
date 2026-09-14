<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { useRouter } from 'vue-router';
import { db as defaultDb } from '../../data/db';
import type { GaokaoDatabase } from '../../data/db';
import type { Session } from '../../data/migrations';
import { loadPersonalSettings } from '../../services/settings';
import { collectLevelUpEvidence, createTodaySession, previewTodayPlan } from '../../services/learning';
import type { PlanGroup, PlanTodayResult } from '../../domain/planner';
import AppButton from '../../components/AppButton.vue';

const props = defineProps<{
  db?: GaokaoDatabase;
}>();

const router = useRouter();
const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

const message = ref<string | null>(null);
const resumable = ref<Session[]>([]);
const hasContent = ref(false);
// 首次使用（settings 表还没有 personal 记录）时引导到学习设置页；「跳过」保存后不再出现
const needsSetup = ref(false);
const plan = ref<PlanTodayResult | null>(null);
const planGroups = ref<PlanGroup[]>([]);
const planToday = ref('');
const planMinutes = ref(10);
const planProfileId = ref('gaokao-common-training-v1');
const starting = ref(false);
const suggestion = ref<{ kind: 'up' | 'support' | 'hold'; headline: string; detail: string } | null>(null);
const suggestionDismissed = ref(false);

const SUGGESTION_DISMISS_KEY = 'gaokao-levelup-dismissed-day';

const describeGroup = (group: PlanGroup): string => {
  const kindLabel = group.kind === 'review' ? '复习' : '新内容';
  const familiarLabel = group.familiarRetry ? '（熟题复习）' : '';
  return kindLabel + ' · ' + group.unitTitleZh + ' · ' + group.items.length + ' 题' + familiarLabel;
};

const loadState = async (): Promise<void> => {
  try {
    const sessions = await db.value.sessions.toArray();
    resumable.value = sessions
      .filter((session) => session.state === 'active' || session.state === 'paused')
      .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
      .slice(0, 3);
  } catch {
    resumable.value = [];
  }
  try {
    const packs = await db.value.packs.toArray();
    hasContent.value = packs.some((record) => record.status === 'installed' && record.resourcesReady);
  } catch {
    hasContent.value = false;
  }
  try {
    const settings = await loadPersonalSettings(db.value);
    planMinutes.value = settings.defaultMinutes;
    planProfileId.value = settings.profileId;
  } catch {
    planMinutes.value = 10;
  }
  try {
    needsSetup.value = (await db.value.settings.get('personal')) === undefined;
  } catch {
    needsSetup.value = false;
  }
  plan.value = null;
  planGroups.value = [];
  suggestion.value = null;
  if (!hasContent.value) return;
  try {
    const preview = await previewTodayPlan({ db: db.value, minutes: planMinutes.value, profileId: planProfileId.value });
    if (preview.ok) {
      plan.value = preview.value.plan;
      planGroups.value = preview.value.plan.groups;
      planToday.value = preview.value.today;
    }
  } catch {
    plan.value = null;
  }
  try {
    const evidence = await collectLevelUpEvidence(db.value, planProfileId.value);
    if (evidence.ok) {
      const found = evidence.value.suggestion;
      if (found.kind === 'up') {
        suggestion.value = {
          kind: 'up',
          headline: '建议尝试下一层 ' + found.toLevel,
          detail: '最近 ' + found.evidence.firstAttempts + ' 次独立首次作答正确率 ' + Math.round(found.evidence.accuracy * 100) + '%（' + found.evidence.distinctDays + ' 个学习日、' + found.evidence.families + ' 个题目家族）。可接受或忽略。',
        };
      } else if (found.kind === 'support') {
        suggestion.value = {
          kind: 'support',
          headline: '建议使用基础提示或降低难度',
          detail: '最近连续 3 次首次作答错误。可以先回顾提示再重试，或选择更基础的单元。',
        };
      } else {
        suggestion.value = {
          kind: 'hold',
          headline: '能力建议待复测',
          detail: found.sampleShown + '（需至少 10 次独立首次作答，覆盖 2 个以上学习日与 3 个题目家族，正确率 80%）。',
        };
      }
    }
  } catch {
    suggestion.value = null;
  }
  try {
    suggestionDismissed.value = globalThis.localStorage?.getItem(SUGGESTION_DISMISS_KEY) === planToday.value;
  } catch {
    suggestionDismissed.value = false;
  }
};

onMounted(loadState);

const startTodayPractice = async (): Promise<void> => {
  if (!hasContent.value) {
    message.value = '暂无可用课程，请先准备学习内容。';
    return;
  }
  await loadState();
  await router.push('/learn');
};

const startTodayPlan = async (): Promise<void> => {
  if (starting.value) return;
  starting.value = true;
  try {
    const created = await createTodaySession({ db: db.value, minutes: planMinutes.value, profileId: planProfileId.value });
    if (!created.ok || created.value.kind !== 'session') {
      message.value = created.ok ? '未能创建今日会话' : created.error.messageZh;
      return;
    }
    await router.push('/session/' + created.value.session.id);
  } finally {
    starting.value = false;
  }
};

const dismissSuggestion = (): void => {
  suggestionDismissed.value = true;
  try {
    globalThis.localStorage?.setItem(SUGGESTION_DISMISS_KEY, planToday.value);
  } catch {
    // localStorage 不可用时忽略，本次会话内仍然隐藏
  }
};

const resumePractice = async (session: Session): Promise<void> => {
  await router.push('/session/' + session.id);
};
</script>

<template>
  <section
    class="today-page"
    aria-labelledby="today-title"
  >
    <h2 id="today-title">
      今日练习
    </h2>

    <div
      v-if="needsSetup"
      class="today-setup-card"
      role="note"
      aria-label="学习设置提醒"
    >
      <h3>完成学习设置</h3>
      <p>选择年级、目标与默认练习时长，今日计划会更贴合你的节奏。也可以先跳过，随时在设置中完成。</p>
      <router-link
        to="/onboarding"
        class="today-setup-link"
      >前往学习设置</router-link>
    </div>

    <div
      v-if="hasContent"
      class="today-plan-card"
      aria-label="今日计划"
    >
      <h3>今日计划</h3>
      <p
        v-if="plan === null"
        role="status"
      >
        正在生成今日计划…
      </p>
      <template v-else>
        <p
          v-if="plan.needsLongerSession"
          role="status"
        >
          当前时长装不下完整学习材料组，请选择更长时间或前往课程列表手动选择。
        </p>
        <template v-else-if="planGroups.length > 0">
          <p class="today-plan-summary">
            {{ planToday }} · 复习 {{ plan.reviewCount }} 题 · 新内容 {{ plan.newCount }} 题 · 约 {{ Math.round(plan.totalSeconds / 60) }} 分钟
          </p>
          <ul class="today-plan-groups">
            <li
              v-for="group in planGroups"
              :key="group.unitId + group.kind"
            >
              {{ describeGroup(group) }}
            </li>
          </ul>
          <AppButton
            :disabled="starting"
            @click="startTodayPlan"
          >
            开始今日计划
          </AppButton>
        </template>
        <p
          v-else
          role="status"
        >
          今日没有可安排的任务；当前内容与时长不匹配时需补充平行材料。
        </p>
      </template>
      <p>
        <router-link to="/review">查看复习列表</router-link>
        <router-link to="/progress">成长记录</router-link>
        <router-link to="/downloads">下载课程</router-link>
        <router-link to="/settings">设置与备份</router-link>
      </p>
    </div>

    <div
      v-if="suggestion !== null && !suggestionDismissed"
      class="levelup-card"
      role="note"
      aria-label="分层建议"
    >
      <h3>{{ suggestion.headline }}</h3>
      <p>{{ suggestion.detail }}</p>
      <AppButton
        variant="ghost"
        @click="dismissSuggestion"
      >
        忽略建议
      </AppButton>
    </div>

    <ul
      v-if="resumable.length > 0"
      class="resume-list"
    >
      <li
        v-for="session in resumable"
        :key="session.id"
        class="resume-item"
      >
        <AppButton
          variant="secondary"
          @click="resumePractice(session)"
        >
          继续上次练习
        </AppButton>
      </li>
    </ul>

    <p
      v-if="message !== null"
      role="status"
    >
      {{ message }}
    </p>

    <div class="today-actions">
      <AppButton @click="startTodayPractice">
        开始今日练习
      </AppButton>
      <router-link
        to="/learn"
        class="learn-link"
      >前往课程列表</router-link>
      <router-link
        to="/downloads"
        class="downloads-link"
      >下载课程</router-link>
    </div>
  </section>
</template>
