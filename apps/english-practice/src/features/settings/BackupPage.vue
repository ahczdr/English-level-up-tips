<template>
  <section class="backup-page">
    <h1>备份与恢复</h1>

    <div class="backup-block">
      <h2>导出备份</h2>
      <p class="backup-note">
        备份包含个人设置、课程快照、练习会话、作答、曝光、复习状态、写作与成就（不含音频文件与下载缓存）。
        摘要按键排序 JSON 计算，跨设备一致。
      </p>
      <button type="button" class="backup-export" :disabled="busy" @click="exportBackupFile">导出备份文件</button>
      <p v-if="exportInfo" class="backup-message" role="status">{{ exportInfo }}</p>
    </div>

    <div class="backup-block">
      <h2>导入恢复</h2>
      <p class="backup-note">
        iOS Safari：重装或安装到主屏幕前先导出备份；安装后在新库中用本页导入恢复。
        恢复将<b>整库替换</b>当前学习记录，请先导出现有数据。音频需在下载页重新下载。
      </p>
      <input
        class="backup-file-input"
        type="file"
        accept="application/json,.json"
        aria-label="选择备份文件"
        :disabled="busy"
        @change="onFileSelected"
      />
      <div v-if="hasPendingEnvelope">
        <div class="backup-summary" role="status">
          <p>备份校验通过，将替换当前全部学习记录：</p>
          <ul>
            <li>练习会话：{{ pendingCounts.sessions }} 条</li>
            <li>作答记录：{{ pendingCounts.attempts }} 条</li>
            <li>课程快照：{{ pendingCounts.packs }} 个</li>
            <li>复习状态：{{ pendingCounts.reviewStates }} 条 · 写作版本：{{ pendingCounts.writingVersions }} 条 · 成就：{{ pendingCounts.achievements }} 条</li>
            <li>导出时间：{{ pendingExportedAt }} · 应用版本：{{ pendingAppVersion }}</li>
          </ul>
        </div>
        <button type="button" class="backup-restore" :disabled="busy" @click="confirmRestore">确认恢复（替换当前数据）</button>
        <button type="button" class="backup-cancel" :disabled="busy" @click="resetPending">取消</button>
      </div>
      <p v-if="message" class="backup-message" role="status">{{ message }}</p>
    </div>

    <router-link class="backup-back" to="/settings">返回设置</router-link>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRaw } from 'vue';
import { db as defaultDb, type GaokaoDatabase } from '../../data/db';
import { exportBackup, restoreBackup, validateBackupJson, MAX_ATTEMPT_RECORDS, MAX_BACKUP_BYTES, type BackupEnvelope } from '../../data/backup';

const props = defineProps<{ db?: GaokaoDatabase }>();

const busy = ref(false);
const exportInfo = ref('');
const message = ref('');
// envelope 保存在非响应式变量中：Vue ref 会深度代理对象，Proxy 无法写入 IndexedDB（DataCloneError）
let pendingEnvelope: BackupEnvelope | null = null;
const hasPendingEnvelope = ref(false);
const pendingCounts = ref<Record<string, number>>({ sessions: 0, attempts: 0, packs: 0, reviewStates: 0, writingVersions: 0, achievements: 0 });
const pendingExportedAt = ref('');
const pendingAppVersion = ref('');

const resolveDb = (): GaokaoDatabase => toRaw(props.db) ?? defaultDb;

const exportBackupFile = async (): Promise<void> => {
  busy.value = true;
  message.value = '';
  try {
    const result = await exportBackup({ db: resolveDb() });
    if (!result.ok) {
      exportInfo.value = result.error.messageZh;
      return;
    }
    const blob = new Blob([result.value.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'gaokao-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    anchor.click();
    URL.revokeObjectURL(url);
    // R6（D09）：导出侧超限明确提示，避免「导出成功但永远导不回」的静默陷阱
    let warning = '';
    if (result.value.sizeBytes > MAX_BACKUP_BYTES) warning = '；警告：备份体积超过 50 MiB，导入时会被拒绝，请减少本机数据后重试';
    const attemptCount = (result.value.envelope.payload as unknown as Record<string, unknown[]>).attempts.length;
    if (attemptCount > MAX_ATTEMPT_RECORDS) warning += '；警告：作答记录超过 ' + String(MAX_ATTEMPT_RECORDS) + ' 条，导入时会被拒绝';
    exportInfo.value = '已导出 ' + String(result.value.sizeBytes) + ' 字节（摘要 ' + result.value.envelope.payloadSha256.slice(0, 12) + '…）' + warning;
  } finally {
    busy.value = false;
  }
};

const resetPending = (): void => {
  pendingEnvelope = null;
  hasPendingEnvelope.value = false;
};

const onFileSelected = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  message.value = '';
  resetPending();
  try {
    // R4：体积预检前移——大文件先按 file.size 拒绝，避免全量入内存
    if (file.size > MAX_BACKUP_BYTES) {
      message.value = '备份文件超过 ' + String(Math.round(MAX_BACKUP_BYTES / (1024 * 1024))) + ' MiB 限制，拒绝导入';
      return;
    }
    const text = await file.text();
    const check = await validateBackupJson({ text });
    if (!check.ok) {
      message.value = check.error.messageZh;
      return;
    }
    pendingEnvelope = check.value;
    hasPendingEnvelope.value = true;
    const payload = check.value.payload as unknown as Record<string, unknown[]>;
    pendingCounts.value = {
      sessions: payload.sessions.length,
      attempts: payload.attempts.length,
      packs: payload.packs.length,
      reviewStates: payload.reviewStates.length,
      writingVersions: payload.writingVersions.length,
      achievements: payload.achievements.length,
    };
    pendingExportedAt.value = check.value.exportedAt.slice(0, 19).replace('T', ' ');
    pendingAppVersion.value = check.value.appVersion;
  } catch {
    message.value = '备份文件读取失败，请重试';
  } finally {
    busy.value = false;
    input.value = '';
  }
};

const confirmRestore = async (): Promise<void> => {
  const envelope = pendingEnvelope;
  if (!envelope) return;
  busy.value = true;
  try {
    const result = await restoreBackup({ db: resolveDb(), envelope });
    if (!result.ok) {
      message.value = result.error.messageZh;
      return;
    }
    message.value = '恢复完成：' + String(result.value.audioPacksNeedingDownload) + ' 个课程包的音频需重新下载，请前往下载页。';
    resetPending();
  } finally {
    busy.value = false;
  }
};

onMounted(() => {
  resetPending();
});

onBeforeUnmount(() => {
  resetPending();
});
</script>
