<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import type { WritingItem } from '../../content/types';
import type { GaokaoDatabase } from '../../data/db';
import { loadSession, revealHint } from '../../services/learning';
import {
  countEnglishWords,
  finalizeWriting,
  listWritingVersions,
  loadWritingDraft,
  saveWritingDraft,
  type WritingVersionBody,
} from '../../services/writing';
import AppButton from '../../components/AppButton.vue';

const props = defineProps<{
  db: GaokaoDatabase;
  sessionId: string;
  slotId: string;
  item: WritingItem;
  sessionRevision: number;
}>();

const emit = defineEmits<{
  (e: 'finalized'): void;
}>();

// props.db 会被 Vue 深度响应化成代理，Dexie 事务在代理上会抛 PrematureCommitError
// （T05 已知坑），这里 toRaw 解包后再传给服务层。
const db = computed<GaokaoDatabase>(() => toRaw(props.db) as GaokaoDatabase);

// 会话 revision 以父级传入为准，但 finalize 成功后本地先行 +1，
// 避免父级重载完成前再次提交被误判 STALE
const sessionRevision = ref(props.sessionRevision);
watch(
  () => props.sessionRevision,
  (value) => {
    // revision 只增不减：父级快照只会更新或持平，不回写倒退
    if (value > sessionRevision.value) sessionRevision.value = value;
  },
);

const content = ref('');
const outline = ref('');
const checklist = ref<string[]>([]);
const revision = ref(0);
const loaded = ref(false);
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const finalizeError = ref('');
const versions = ref<WritingVersionBody[]>([]);
const modelAnswerVisible = ref(false);

let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
let dirty = false;

const wordCount = computed(() => countEnglishWords(content.value));
const submitted = computed(() => versions.value.length > 0);
const isContinuation = computed(() => props.item.openingSentences.length > 0);

const persist = async (): Promise<boolean> => {
  saveState.value = 'saving';
  const result = await saveWritingDraft({
    db: db.value,
    sessionId: props.sessionId,
    itemId: props.item.id,
    content: content.value,
    outline: outline.value,
    checklist: [...checklist.value],
    expectedRevision: revision.value,
  });
  if (!result.ok) {
    saveState.value = 'error';
    return false;
  }
  revision.value = result.value.revision;
  saveState.value = 'saved';
  dirty = false;
  return true;
};

const scheduleSave = (): void => {
  if (!loaded.value) return;
  dirty = true;
  if (timer !== null) globalThis.clearTimeout(timer);
  timer = globalThis.setTimeout(() => {
    timer = null;
    void persist();
  }, 500);
};

watch([content, outline], () => scheduleSave());
watch(checklist, () => scheduleSave(), { deep: true });

onMounted(async () => {
  try {
    const draft = await loadWritingDraft({ db: db.value, sessionId: props.sessionId, itemId: props.item.id });
    if (draft.ok && draft.value) {
      content.value = draft.value.content;
      outline.value = draft.value.outline;
      checklist.value = [...draft.value.checklist];
      revision.value = draft.value.revision;
    }
    versions.value = await listWritingVersions({ db: db.value, sessionId: props.sessionId, itemId: props.item.id });
    // 范文已记录过（assistance 含 model-answer）则重开即展示，不重复请求/推进 revision
    const sessionRow = await db.value.sessions.get(props.sessionId);
    const slot = sessionRow?.slots.find((candidate) => candidate.id === props.slotId);
    if (slot?.assistance.includes('model-answer')) modelAnswerVisible.value = true;
    // 挂载时以数据库为准校准会话 revision（props 可能携带父级旧快照）
    if (sessionRow && sessionRow.revision > sessionRevision.value) sessionRevision.value = sessionRow.revision;
  } catch {
    finalizeError.value = '写作历史读取失败，正文仍可编辑与保存';
  } finally {
    loaded.value = true;
  }
});

onBeforeUnmount(() => {
  if (timer !== null) globalThis.clearTimeout(timer);
});

// 供父级在离开页面前等待最后一次写入；返回 false 表示最后一次写入失败
const flushPending = async (): Promise<boolean> => {
  if (timer !== null) {
    globalThis.clearTimeout(timer);
    timer = null;
    if (dirty) return await persist();
    return true;
  }
  if (dirty) return await persist();
  return true;
};

// 供父级在丢弃草稿（跳过此题）前取消在途防抖，避免 clearDraft 后被自动保存复活
const abortPending = (): void => {
  if (timer !== null) {
    globalThis.clearTimeout(timer);
    timer = null;
  }
  dirty = false;
};

const isDirty = computed(() => dirty || timer !== null);
defineExpose({ flushPending, abortPending, isDirty });

const resyncRevision = async (): Promise<void> => {
  const reloaded = await loadSession(db.value, props.sessionId);
  if (reloaded.ok) sessionRevision.value = reloaded.value.revision;
};

const finalizing = ref(false);

const finalize = async (): Promise<void> => {
  if (finalizing.value) return;
  finalizing.value = true;
  try {
    finalizeError.value = '';
    // 先保存最新正文（不等 500ms 防抖）；保存失败则中止提交，绝不冻结旧稿
    if (dirty || timer !== null) {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
      }
      const flushed = await persist();
      if (!flushed) {
        finalizeError.value = '正文尚未保存成功，已中止提交，请重试';
        return;
      }
    }
    const result = await finalizeWriting({
      db: db.value,
      sessionId: props.sessionId,
      slotId: props.slotId,
      expectedRevision: sessionRevision.value,
    });
    if (!result.ok) {
      finalizeError.value = result.error.messageZh;
      if (result.error.code === 'STALE_SESSION') await resyncRevision();
      return;
    }
    sessionRevision.value += 1;
    versions.value = await listWritingVersions({ db: db.value, sessionId: props.sessionId, itemId: props.item.id });
    emit('finalized');
  } finally {
    finalizing.value = false;
  }
};

const showModelAnswer = async (): Promise<void> => {
  const result = await revealHint(db.value, {
    sessionId: props.sessionId,
    slotId: props.slotId,
    hint: 'model-answer',
    expectedRevision: sessionRevision.value,
  });
  if (!result.ok) {
    if (result.error.code === 'STALE_SESSION') await resyncRevision();
    return;
  }
  // 以服务返回的会话为准：重复请求不 bump revision，本地不超前
  sessionRevision.value = result.value.revision;
  modelAnswerVisible.value = true;
};

const copyBody = async (): Promise<void> => {
  try {
    await globalThis.navigator?.clipboard?.writeText(content.value);
  } catch {
    // 剪贴板不可用时静默失败：文本仍在编辑器中
  }
};

const toggleChecklist = (label: string): void => {
  if (checklist.value.includes(label)) {
    checklist.value = checklist.value.filter((item) => item !== label);
  } else {
    checklist.value = [...checklist.value, label];
  }
};
</script>

<template>
  <div class="writing-page">
    <div class="writing-brief">
      <h4>审题要求</h4>
      <ul>
        <li
          v-for="requirement in item.requirementsZh"
          :key="requirement"
        >
          {{ requirement }}
        </li>
      </ul>
      <p
        v-if="isContinuation"
        class="writing-openings"
      >
        续写段首句：
        <span
          v-for="opening in item.openingSentences"
          :key="opening"
          class="writing-opening"
        >{{ opening }}</span>
      </p>
    </div>

    <label
      class="writing-outline-label"
      for="writing-outline"
    >可选提纲</label>
    <textarea
      id="writing-outline"
      v-model="outline"
      class="writing-outline"
      rows="2"
      placeholder="可先列提纲（可选）"
    ></textarea>

    <label
      class="writing-body-label"
      for="writing-body"
    >正文</label>
    <textarea
      id="writing-body"
      v-model="content"
      class="writing-body"
      rows="8"
      placeholder="在这里写作"
    ></textarea>

    <p class="writing-count">
      字数 {{ wordCount }} 词（建议 {{ item.wordRange[0] }}–{{ item.wordRange[1] }} 词，仅作参考）
    </p>

    <fieldset class="writing-checklist">
      <legend>自评表</legend>
      <label
        v-for="entry in item.checklistZh"
        :key="entry"
        class="writing-check"
      >
        <input
          type="checkbox"
          :checked="checklist.includes(entry)"
          @change="toggleChecklist(entry)"
        />
        {{ entry }}
      </label>
    </fieldset>

    <div class="writing-save-state">
      <span
        v-if="saveState === 'saving'"
        role="status"
      >保存中…</span>
      <span
        v-else-if="saveState === 'saved'"
        role="status"
      >已保存</span>
      <span
        v-else-if="saveState === 'error'"
        role="alert"
        class="writing-save-error"
      >
        保存失败，正文已保留。
        <AppButton
          variant="secondary"
          @click="copyBody"
        >
          复制正文
        </AppButton>
      </span>
    </div>

    <div class="writing-actions">
      <AppButton
        v-if="!submitted"
        :disabled="finalizing"
        @click="finalize"
      >
        提交初稿
      </AppButton>
      <AppButton
        v-else
        :disabled="finalizing"
        @click="finalize"
      >
        提交修改稿
      </AppButton>
      <AppButton
        v-if="!modelAnswerVisible"
        variant="ghost"
        @click="showModelAnswer"
      >
        查看范文
      </AppButton>
    </div>

    <p
      v-if="finalizeError !== ''"
      role="alert"
      class="writing-finalize-error"
    >
      {{ finalizeError }}
    </p>

    <div
      v-if="submitted"
      class="writing-submitted"
    >
      <p role="status">已提交 {{ versions.length }} 个版本（首稿不可覆盖，修改会生成新版本）。</p>
      <div class="writing-compare">
        <h4>版本句段对比</h4>
        <div
          v-for="version in versions"
          :key="version.version"
          class="writing-version"
        >
          <p class="writing-version-title">
            {{ version.version === 1 ? '初稿' : `修改稿 v${version.version}` }}
          </p>
          <pre class="writing-version-body">{{ version.content }}</pre>
        </div>
      </div>
    </div>

    <div
      v-if="modelAnswerVisible"
      class="writing-model"
    >
      <h4>范文（显式请求后展示）</h4>
      <pre class="writing-model-body">{{ item.modelAnswer }}</pre>
    </div>
  </div>
</template>
