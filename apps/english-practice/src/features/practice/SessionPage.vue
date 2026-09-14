<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CoursePack, Evidence, GapsItem, Item, Resource } from '../../content/types';
import { db as defaultDb } from '../../data/db';
import type { GaokaoDatabase } from '../../data/db';
import type { Session } from '../../data/migrations';
import type { Answer } from '../../domain/answers';
import {
  completeSession,
  correctAnswer,
  enterCurrentSlot,
  loadSession,
  pauseSession,
  recordReplay,
  resumeSession,
  revealHint,
  setAudioSpeed,
  skipSlot,
  submitAnswer,
  type Attempt,
} from '../../services/learning';
import { allPackRecords } from '../../data/pack-reader';
import { getSessionSummary, setCurrentIndex, type SessionSummary } from '../../services/sessionFlow';
import { clearDraft, loadDraft, saveDraft } from '../../services/drafts';
import { getPackAssetBytes } from '../../services/content';
import { startPackDownload } from '../../services/downloads';
import { setActiveSessionFlag } from '../../pwa/register';
import AppButton from '../../components/AppButton.vue';
import AudioPlayer from '../../components/AudioPlayer.vue';
import FeedbackPanel from '../../components/FeedbackPanel.vue';
import PassagePanel from '../../components/PassagePanel.vue';
import WritingPage from '../writing/WritingPage.vue';
import ChoiceTask from './ChoiceTask.vue';
import OrderTask from './OrderTask.vue';
import GapTask from './GapTask.vue';

const props = defineProps<{
  db?: GaokaoDatabase;
  sessionId?: string;
}>();

const route = useRoute();
const router = useRouter();
// 测试环境（vue-test-utils）传入的 db prop 会被 Vue 深度代理，Dexie 事务在代理上会失效
// （PrematureCommitError），因此用 toRaw 取回原始实例；单例 defaultDb 本身不受影响。
const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

type Phase = 'loading' | 'active' | 'summary' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type AnswerMode = 'first' | 'correction';

const phase = ref<Phase>('loading');
const errorMessage = ref('');
const session = ref<Session | null>(null);
const item = ref<Item | null>(null);
const resource = ref<Resource | null>(null);
const pack = ref<CoursePack | null>(null);
const draft = ref<Answer | null>(null);
const saveState = ref<SaveState>('idle');
const saveMessage = ref('');
const firstAttemptLabel = ref('');
const feedback = ref<Attempt | null>(null);
const mode = ref<AnswerMode>('first');
const confirmPending = ref(false);
const exitConfirm = ref(false);
const hintVisible = ref(false);
const commandId = ref<string | null>(null);
const summary = ref<SessionSummary | null>(null);
// 换题/跳过/提示等会推进 revision 的在途闸：触屏双击不产生并发服务调用与 STALE 误报
const transitioning = ref(false);
// T06 阅读布局：手机在文章/题目两个独立滚动窗格间切换（保留各自滚动位置）
const readingView = ref<'article' | 'task'>('task');
const activeHighlights = ref<Evidence[]>([]);
const passagePanelRef = ref<InstanceType<typeof PassagePanel> | null>(null);

const sessionIdValue = computed(
  () => props.sessionId ?? (typeof route.params.id === 'string' ? route.params.id : ''),
);

const currentIndex = computed(() => session.value?.currentIndex ?? 0);
const totalSlots = computed(() => session.value?.slots.length ?? 0);
const progressText = computed(() => `第 ${currentIndex.value + 1} / ${totalSlots.value} 题`);
const isDraftPack = computed(() => pack.value?.status !== 'published');

const draftIsEmptyGaps = computed((): boolean => {
  const answer = draft.value;
  const currentItem = item.value;
  if (!answer || answer.kind !== 'gaps') return false;
  if (!currentItem || currentItem.kind !== 'gaps') return false;
  const gaps = currentItem as GapsItem;
  return gaps.gaps.every((gap) => (answer.values[gap.id] ?? '').trim() === '');
});

const draftHasEmptyGap = computed((): boolean => {
  const answer = draft.value;
  const currentItem = item.value;
  if (!answer || answer.kind !== 'gaps') return false;
  if (!currentItem || currentItem.kind !== 'gaps') return false;
  const gaps = currentItem as GapsItem;
  return gaps.gaps.some((gap) => (answer.values[gap.id] ?? '').trim() === '');
});

const taskDisabled = computed(() => saveState.value === 'saving' || (feedback.value !== null && mode.value === 'first'));
const submitDisabled = computed(
  () => draft.value === null || draftIsEmptyGaps.value || saveState.value === 'saving' || feedback.value !== null,
);
// T09：写作草稿的未保存状态由 WritingPage 暴露（500ms 防抖中的输入也算未保存）
const writingRef = ref<InstanceType<typeof WritingPage> | null>(null);
const hasUnsavedDraft = computed(
  () => (draft.value !== null && feedback.value === null) || (writingRef.value?.isDirty ?? false),
);
const isWritingSubmitted = computed(
  () => item.value?.kind === 'writing' && currentSlot.value?.state === 'submitted',
);
const canCorrect = computed(
  () =>
    feedback.value !== null &&
    feedback.value.phase === 'first' &&
    feedback.value.grade.earned < feedback.value.grade.possible,
);

const firstUnfinishedIndex = (target: Session): number =>
  target.slots.findIndex((slot) => slot.state === 'unseen' || slot.state === 'answering');

const showError = (messageZh: string): void => {
  errorMessage.value = messageZh;
  phase.value = 'error';
};

const resetSlotState = (): void => {
  draft.value = null;
  feedback.value = null;
  saveState.value = 'idle';
  saveMessage.value = '';
  mode.value = 'first';
  confirmPending.value = false;
  exitConfirm.value = false;
  hintVisible.value = false;
  commandId.value = null;
  readingView.value = 'task';
  activeHighlights.value = [];
  transcriptVisible.value = false;
};

// T07：text 模式草稿自动保存——只进 drafts 表，绝不产生 Attempt（草稿不是作答）
const DRAFT_SAVE_DELAY_MS = 250;
let draftSaveTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let pendingDraftSave: { sessionId: string; itemId: string; answer: Answer } | null = null;

const cancelPendingDraftSave = (): void => {
  if (draftSaveTimer !== null) {
    globalThis.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  pendingDraftSave = null;
};

const flushPendingDraftSave = async (): Promise<void> => {
  const pending = pendingDraftSave;
  cancelPendingDraftSave();
  if (!pending) return;
  try {
    await saveDraft(db.value, pending);
  } catch {
    // 草稿保存失败不影响作答主流程（作答以提交为准）
  }
};

watch(draft, (value) => {
  const target = session.value;
  const currentItem = item.value;
  if (!target || !currentItem || currentItem.kind !== 'gaps') return;
  if (feedback.value !== null) return;
  const slot = target.slots[target.currentIndex];
  if (!slot || slot.state !== 'answering') return;
  if (!value || value.kind !== 'gaps') return;
  pendingDraftSave = { sessionId: target.id, itemId: currentItem.id, answer: value };
  if (draftSaveTimer !== null) globalThis.clearTimeout(draftSaveTimer);
  draftSaveTimer = globalThis.setTimeout(() => {
    draftSaveTimer = null;
    void flushPendingDraftSave();
  }, DRAFT_SAVE_DELAY_MS);
});

onBeforeUnmount(() => {
  setActiveSessionFlag(false);
  void flushPendingDraftSave();
});

// 进入未完成题目时恢复已保存的草稿（已提交/已跳过的题目不恢复）
const restoreDraft = async (target: Session): Promise<void> => {
  const slot = target.slots[target.currentIndex];
  const currentItem = item.value;
  if (!slot || !currentItem || currentItem.kind !== 'gaps') return;
  if (slot.state !== 'answering') return;
  if (feedback.value !== null) return;
  const result = await loadDraft(db.value, { sessionId: target.id, itemId: currentItem.id });
  if (!result.ok || !result.value || result.value.kind !== 'gaps') return;
  draft.value = result.value;
};

// 提交后点击反馈证据：切到文章窗格并滚动到对应段落（高亮由 PassagePanel 渲染）
const jumpToEvidence = async (evidence: Evidence): Promise<void> => {
  if (!resource.value || evidence.resourceId !== resource.value.id) return;
  const known = activeHighlights.value.some(
    (entry) => entry.paragraphId === evidence.paragraphId && entry.quote === evidence.quote,
  );
  if (!known) activeHighlights.value = [...activeHighlights.value, evidence];
  readingView.value = 'article';
  await nextTick();
  passagePanelRef.value?.scrollToParagraph(evidence.paragraphId);
};

const refreshSummary = async (): Promise<void> => {
  const target = session.value;
  if (!target) return;
  const result = await getSessionSummary(db.value, target.id);
  if (result.ok) summary.value = result.value;
};

// CR1：全部题目完成进入总结前，把会话置为 completed 并清理残留草稿；
// 失败不阻塞总结展示（状态推进非关键路径）
const finishSession = async (target: Session): Promise<void> => {
  const completed = await completeSession(db.value, target.id);
  if (completed.ok) session.value = completed.value;
  phase.value = 'summary';
  await refreshSummary();
};

// T08：听力音频状态——bytes 只经 downloadJobs（原始 ArrayBuffer），离开题组由 AudioPlayer 卸载停止
const audioBytes = ref<ArrayBuffer | null>(null);
const audioMime = ref('audio/mp4');
const audioState = ref<'idle' | 'loading' | 'ready' | 'missing'>('idle');
const downloading = ref(false);
const transcriptVisible = ref(false);

const currentSlot = computed<Session['slots'][number] | null>(
  () => session.value?.slots[session.value.currentIndex] ?? null,
);

const isListening = computed(() => item.value !== null && item.value.section === 'listening');

const loadAudio = async (target: Session, packRecord: CoursePack | null): Promise<void> => {
  const slot = target.slots[target.currentIndex];
  const currentItem = item.value;
  if (!slot || !currentItem || currentItem.section !== 'listening' || !packRecord) {
    audioState.value = 'idle';
    audioBytes.value = null;
    transcriptVisible.value = false;
    return;
  }
  const resource = currentItem.resourceId
    ? packRecord.resources.find((candidate) => candidate.id === currentItem.resourceId) ?? null
    : null;
  const assetId = resource?.audioAssetId ?? null;
  if (assetId === null) {
    audioState.value = 'missing';
    audioBytes.value = null;
    return;
  }
  audioState.value = 'loading';
  const result = await getPackAssetBytes({ db: db.value, packId: slot.ref.packId, version: slot.ref.packVersion, assetId });
  if (!result.ok) {
    audioState.value = 'missing';
    audioBytes.value = null;
    return;
  }
  audioMime.value = result.value.mime;
  audioBytes.value = result.value.data;
  audioState.value = 'ready';
};

const downloadAudio = async (): Promise<void> => {
  const target = session.value;
  const slot = target?.slots[target.currentIndex];
  if (!target || !slot || downloading.value) return;
  downloading.value = true;
  try {
    // R7：走 T12 状态机（含空间估算与 downloading/verifying 状态落库）
    const result = await startPackDownload({ db: db.value, packId: slot.ref.packId, version: slot.ref.packVersion });
    if (!result.ok) {
      saveState.value = 'error';
      saveMessage.value = result.error.messageZh;
      return;
    }
    await loadAudio(target, pack.value);
  } finally {
    downloading.value = false;
  }
};

const showTranscript = async (): Promise<void> => {
  const target = session.value;
  const slot = target?.slots[target.currentIndex];
  if (!target || !slot || transcriptVisible.value || transitioning.value) return;
  const result = await revealHint(db.value, {
    sessionId: target.id,
    slotId: slot.id,
    hint: 'transcript',
    expectedRevision: target.revision,
  });
  if (!result.ok) {
    saveState.value = 'error';
    saveMessage.value = result.error.messageZh;
    return;
  }
  session.value = result.value;
  transcriptVisible.value = true;
};

const onReplay = async (): Promise<void> => {
  const target = session.value;
  const slot = target?.slots[target.currentIndex];
  if (!target || !slot) return;
  const result = await recordReplay(db.value, {
    sessionId: target.id,
    slotId: slot.id,
    expectedRevision: target.revision,
  });
  if (!result.ok) {
    saveState.value = 'error';
    saveMessage.value = result.error.messageZh;
    return;
  }
  session.value = result.value;
};

const onWritingFinalized = async (): Promise<void> => {
  const target = session.value;
  if (!target) return;
  const reloaded = await loadSession(db.value, target.id);
  if (reloaded.ok) session.value = reloaded.value;
};

const onSpeed = async (speed: number): Promise<void> => {
  const target = session.value;
  const slot = target?.slots[target.currentIndex];
  if (!target || !slot) return;
  const result = await setAudioSpeed(db.value, {
    sessionId: target.id,
    slotId: slot.id,
    expectedRevision: target.revision,
    speed,
  });
  if (!result.ok) {
    saveState.value = 'error';
    saveMessage.value = result.error.messageZh;
    return;
  }
  session.value = result.value;
};

const loadSlotContent = async (target: Session): Promise<void> => {
  const slot = target.slots[target.currentIndex];
  if (!slot) {
    item.value = null;
    resource.value = null;
    return;
  }
  const records = (await allPackRecords(db.value)).filter((candidate) => candidate.status === 'installed' && candidate.resourcesReady);
  const record = records.find((candidate) => {
    const candidatePack = candidate.pack as CoursePack;
    return candidatePack.id === slot.ref.packId && candidatePack.version === slot.ref.packVersion;
  });
  const currentPack = (record?.pack as CoursePack | undefined) ?? null;
  pack.value = currentPack;
  const currentItem = currentPack?.items.find((candidate) => candidate.id === slot.ref.itemId) ?? null;
  item.value = currentItem;
  if (currentItem?.resourceId) {
    resource.value = currentPack?.resources.find((candidate) => candidate.id === currentItem.resourceId) ?? null;
  } else {
    resource.value = null;
  }
  await loadAudio(target, currentPack);
};

const enterSlot = async (target: Session): Promise<void> => {
  let working = target;
  const next = firstUnfinishedIndex(working);
  if (next === -1) {
    await finishSession(working);
    return;
  }
  if (working.currentIndex !== next) {
    const moved = await setCurrentIndex(db.value, working.id, next, working.revision);
    if (!moved.ok) {
      showError(moved.error.messageZh);
      return;
    }
    working = moved.value;
  }
  const entered = await enterCurrentSlot(db.value, working.id);
  if (!entered.ok) {
    showError(entered.error.messageZh);
    return;
  }
  session.value = entered.value;
  await loadSlotContent(entered.value);
  resetSlotState();
  await restoreDraft(entered.value);
  phase.value = 'active';
};

onMounted(async () => {
  // 活动会话标志：SW 更新提示据此避免练习中途重载（D09）
  setActiveSessionFlag(true);
  const id = sessionIdValue.value;
  if (id === '') {
    showError('未找到指定学习记录');
    return;
  }
  try {
    const loaded = await loadSession(db.value, id);
    if (!loaded.ok) {
      showError(loaded.error.messageZh);
      return;
    }
    let working = loaded.value;
    if (working.state === 'paused') {
      const resumed = await resumeSession(db.value, working.id);
      if (!resumed.ok) {
        showError(resumed.error.messageZh);
        return;
      }
      working = resumed.value;
    }
    session.value = working;
    // T14（learning.spec）：恢复会话时展示首轮作答结果（reload 持久化断言用）
    try {
      const attemptRows = await db.value.attempts.where('sessionId').equals(working.id).toArray();
      const first = attemptRows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (first) {
        const grade = (first.payload as { grade?: { earned?: number; possible?: number } }).grade;
        firstAttemptLabel.value = grade && typeof grade.earned === 'number' && typeof grade.possible === 'number' && grade.possible > 0 && grade.earned === grade.possible ? '正确' : '需订正';
      }
    } catch {
      firstAttemptLabel.value = '';
    }
    await enterSlot(working);
  } catch {
    showError('加载学习记录失败，请稍后重试');
  }
});

const submit = async (): Promise<void> => {
  const target = session.value;
  if (saveState.value === 'saving' || !draft.value || !target || feedback.value !== null) return;
  if (draftIsEmptyGaps.value) return;
  if (confirmPending.value) {
    confirmPending.value = false;
  } else if (draftHasEmptyGap.value) {
    confirmPending.value = true;
    return;
  }
  commandId.value ??= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  saveState.value = 'saving';
  saveMessage.value = '';
  const slot = target.slots[target.currentIndex];
  if (!slot) {
    saveState.value = 'error';
    saveMessage.value = '未找到当前题目，请刷新后再试';
    return;
  }
  const command = {
    id: commandId.value,
    sessionId: target.id,
    slotId: slot.id,
    expectedRevision: target.revision,
    // draft.value 经 ref 深度响应化后是 Vue 代理，直接入库会触发 Dexie 事务异常，需取原始对象
    answer: toRaw(draft.value) as Answer,
  };
  const result = mode.value === 'first' ? await submitAnswer(db.value, command) : await correctAnswer(db.value, command);
  if (!result.ok) {
    saveState.value = 'error';
    saveMessage.value = result.error.messageZh;
    return;
  }
  saveState.value = 'saved';
  saveMessage.value = mode.value === 'first' ? '已保存' : '订正已保存';
  feedback.value = result.value;
  cancelPendingDraftSave();
  void clearDraft(db.value, { sessionId: target.id, itemId: slot.ref.itemId });
  const reloaded = await loadSession(db.value, target.id);
  if (reloaded.ok) session.value = reloaded.value;
};

const startCorrection = (): void => {
  if (!canCorrect.value) return;
  mode.value = 'correction';
  feedback.value = null;
  saveState.value = 'idle';
  saveMessage.value = '';
  commandId.value = null;
  draft.value = null;
};

const requestHint = async (): Promise<void> => {
  const target = session.value;
  const currentItem = item.value;
  if (!target || !currentItem || currentItem.kind === 'writing' || saveState.value === 'saving') return;
  if (hintVisible.value || transitioning.value) return;
  const slot = target.slots[target.currentIndex];
  if (!slot) return;
  transitioning.value = true;
  try {
    const result = await revealHint(db.value, {
      sessionId: target.id,
      slotId: slot.id,
      hint: 'rule',
      expectedRevision: target.revision,
    });
    if (!result.ok) {
      saveState.value = 'error';
      saveMessage.value = result.error.messageZh;
      return;
    }
    session.value = result.value;
    hintVisible.value = true;
  } finally {
    transitioning.value = false;
  }
};

const advanceToNext = async (): Promise<void> => {
  const target = session.value;
  if (!target) return;
  const next = firstUnfinishedIndex(target);
  if (next === -1) {
    await finishSession(target);
    return;
  }
  const moved = await setCurrentIndex(db.value, target.id, next, target.revision);
  if (!moved.ok) {
    showError(moved.error.messageZh);
    return;
  }
  const entered = await enterCurrentSlot(db.value, moved.value.id);
  if (!entered.ok) {
    showError(entered.error.messageZh);
    return;
  }
  session.value = entered.value;
  await loadSlotContent(entered.value);
  resetSlotState();
  await restoreDraft(entered.value);
  phase.value = 'active';
};

const goToNext = async (): Promise<void> => {
  if (transitioning.value) return;
  transitioning.value = true;
  try {
    // 写作题：推进前等待最后一次写入（草稿仍在，仅防抖增量未落盘）
    await writingRef.value?.flushPending();
    await advanceToNext();
  } finally {
    transitioning.value = false;
  }
};

const skipCurrent = async (): Promise<void> => {
  if (transitioning.value) return;
  const target = session.value;
  if (!target || saveState.value === 'saving') return;
  const slot = target.slots[target.currentIndex];
  if (!slot) return;
  transitioning.value = true;
  try {
    const result = await skipSlot(db.value, {
      sessionId: target.id,
      slotId: slot.id,
      expectedRevision: target.revision,
    });
    if (!result.ok) {
      saveState.value = 'error';
      saveMessage.value = result.error.messageZh;
      return;
    }
    session.value = result.value;
    cancelPendingDraftSave();
    writingRef.value?.abortPending();
    void clearDraft(db.value, { sessionId: target.id, itemId: slot.ref.itemId });
    await advanceToNext();
  } finally {
    transitioning.value = false;
  }
};

const pause = async (): Promise<void> => {
  const target = session.value;
  if (!target || saveState.value === 'saving') return;
  const result = await pauseSession(db.value, target.id);
  if (!result.ok) {
    saveState.value = 'error';
    saveMessage.value = result.error.messageZh;
    return;
  }
  await writingRef.value?.flushPending();
  await router.push('/today');
};

const requestExit = async (): Promise<void> => {
  if (hasUnsavedDraft.value) {
    exitConfirm.value = true;
    return;
  }
  await router.push('/today');
};

const stayHere = (): void => {
  exitConfirm.value = false;
};

const confirmExit = async (): Promise<void> => {
  // 离开前等待写作最后一次写入完成（计划要求：离开前等待最后写入）；
  // 失败则留在本页：WritingPage 会显示保存失败与复制正文按钮，用户可重试
  const flushed = (await writingRef.value?.flushPending()) ?? true;
  if (!flushed) {
    exitConfirm.value = true;
    return;
  }
  exitConfirm.value = false;
  await router.push('/today');
};
</script>

<template>
  <section
    class="session-page"
    aria-labelledby="session-title"
  >
    <p
      v-if="phase === 'loading'"
      role="status"
    >
      正在加载练习…
    </p>

    <template v-else-if="phase === 'error'">
      <h2 id="session-title">
        练习
      </h2>
      <p
        role="alert"
        class="session-error"
      >
        {{ errorMessage }}
      </p>
      <AppButton
        variant="secondary"
        @click="router.push('/today')"
      >
        返回今日
      </AppButton>
    </template>

    <div
      v-else-if="phase === 'summary' && summary"
      class="unit-summary"
      aria-labelledby="summary-title"
    >
      <h2 id="summary-title">
        单元结束
      </h2>
      <ul class="summary-count">
        <li>独立首次完成 {{ summary.independentFirst }} 题</li>
        <li>提示后完成 {{ summary.assistedFirst }} 题</li>
        <li>首次未通过 {{ summary.failedFirst }} 题</li>
        <li>已跳过 {{ summary.skippedSlots }} 题</li>
      </ul>
      <AppButton @click="router.push('/today')">
        回到今日
      </AppButton>
    </div>

    <template v-else-if="item && session">
      <div class="session-header">
        <span class="session-progress">{{ progressText }}</span>
        <span
          v-if="isDraftPack"
          class="draft-badge"
        >预览内容（未审核）</span>
        <span
          v-if="firstAttemptLabel !== ''"
          data-testid="first-attempt-result"
          class="session-resume-result"
        >上轮作答：{{ firstAttemptLabel }}</span>
      </div>

      <div
        v-if="isListening"
        class="listening-audio"
      >
        <AudioPlayer
          v-if="audioState === 'ready'"
          :key="item?.id"
          :bytes="audioBytes"
          :mime="audioMime"
          :speed="currentSlot?.audioSpeed ?? 1"
          @replay="onReplay"
          @speed="onSpeed"
        />
        <div
          v-else-if="audioState === 'missing'"
          class="audio-missing-panel"
          role="status"
        >
          <p>音频未下载或加载失败。可下载后练习，或跳过此题——跳过不计入听力错误。</p>
          <AppButton
            :disabled="downloading"
            @click="downloadAudio"
          >
            {{ downloading ? '下载中…' : '下载音频' }}
          </AppButton>
        </div>
        <p
          v-else-if="audioState === 'loading'"
          class="audio-loading"
        >
          音频准备中…
        </p>
        <AppButton
          v-if="feedback === null && audioState === 'ready'"
          variant="ghost"
          :disabled="transcriptVisible || transitioning"
          @click="showTranscript"
        >
          字幕
        </AppButton>
        <p
          v-if="transcriptVisible && resource?.transcript"
          class="audio-transcript"
        >
          {{ resource.transcript }}
        </p>
      </div>

      <div
        class="reading-layout"
        :class="{ 'has-passage': resource !== null && !isListening }"
      >
        <div
          v-if="resource && !isListening"
          class="reading-toggle"
          aria-label="文章与题目切换"
        >
          <button
            type="button"
            class="reading-toggle-option"
            :aria-pressed="readingView === 'article'"
            @click="readingView = 'article'"
          >
            文章
          </button>
          <button
            type="button"
            class="reading-toggle-option"
            :aria-pressed="readingView === 'task'"
            @click="readingView = 'task'"
          >
            题目
          </button>
        </div>
        <div class="reading-panes">
          <PassagePanel
            v-if="resource && !isListening"
            v-show="readingView === 'article'"
            ref="passagePanelRef"
            :key="resource.id"
            :resource="resource"
            :highlights="activeHighlights"
            class="reading-pane reading-pane-article"
          />
          <div
            v-show="resource === null || readingView === 'task'"
            class="reading-pane reading-pane-task"
          >
            <h2
              id="session-title"
              class="session-prompt"
            >
              {{ item.promptZh }}
            </h2>

            <p
              v-if="hintVisible && item.kind !== 'writing'"
              class="hint-text"
            >
              提示：{{ item.explanation.ruleZh }}（已记录辅助）
            </p>

            <WritingPage
              v-if="item.kind === 'writing'"
              ref="writingRef"
              :key="item.id"
              :db="db"
              :session-id="sessionIdValue"
              :slot-id="currentSlot?.id ?? ''"
              :item="item"
              :session-revision="session.revision"
              @finalized="onWritingFinalized"
            />
            <ChoiceTask
              v-else-if="item.kind === 'choice'"
              :key="item.id"
              v-model="draft"
              :item="item"
              :disabled="taskDisabled"
            />
            <OrderTask
              v-else-if="item.kind === 'order'"
              :key="item.id"
              v-model="draft"
              :item="item"
              :disabled="taskDisabled"
            />
            <GapTask
              v-else-if="item.kind === 'gaps'"
              :key="item.id"
              v-model="draft"
              :item="item"
              :disabled="taskDisabled"
            />

            <FeedbackPanel
              :status="saveState"
              :message="saveMessage"
              :attempt="feedback"
              :item="item"
              @jump="jumpToEvidence"
            />

            <div
              v-if="confirmPending"
              class="gap-confirm"
              role="alertdialog"
              aria-label="确认提交"
            >
              <p>仍有未答空位，未答空位将计 0 分。</p>
              <div class="confirm-actions">
                <AppButton @click="submit">
                  确认提交
                </AppButton>
                <AppButton
                  variant="ghost"
                  @click="confirmPending = false"
                >
                  继续作答
                </AppButton>
              </div>
            </div>

            <div class="session-actions">
              <AppButton
                v-if="feedback === null && item.kind !== 'writing'"
                :disabled="submitDisabled"
                @click="submit"
              >
                {{ mode === 'first' ? '提交答案' : '提交订正' }}
              </AppButton>
              <AppButton
                v-if="canCorrect"
                variant="secondary"
                @click="startCorrection"
              >
                订正
              </AppButton>
              <AppButton
                v-if="feedback !== null || isWritingSubmitted"
                :disabled="transitioning"
                @click="goToNext"
              >
                下一题
              </AppButton>
              <AppButton
                v-if="feedback === null && item.kind !== 'writing'"
                variant="ghost"
                :disabled="hintVisible || transitioning"
                @click="requestHint"
              >
                查看提示
              </AppButton>
            </div>

            <div class="session-secondary">
              <AppButton
                v-if="feedback === null"
                variant="ghost"
                :disabled="transitioning"
                @click="skipCurrent"
              >
                跳过此题
              </AppButton>
              <AppButton
                variant="ghost"
                @click="pause"
              >
                暂停
              </AppButton>
              <AppButton
                variant="ghost"
                @click="requestExit"
              >
                返回
              </AppButton>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="exitConfirm"
        class="exit-confirm"
        role="alertdialog"
        aria-label="退出确认"
      >
        <p>仍有未提交的作答内容。已输入内容会自动保存为草稿，下次进入本题时恢复。</p>
        <div class="confirm-actions">
          <AppButton
            variant="secondary"
            @click="confirmExit"
          >
            确认离开
          </AppButton>
          <AppButton
            variant="ghost"
            @click="stayHere"
          >
            继续作答
          </AppButton>
        </div>
      </div>
    </template>
  </section>
</template>
