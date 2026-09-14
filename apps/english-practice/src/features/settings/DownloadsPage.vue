<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { db as defaultDb } from '../../data/db';
import type { GaokaoDatabase } from '../../data/db';
import { collectDownloadOverview, reconcileInstalledPacks, startPackDownload, type DownloadOverviewRow } from '../../services/downloads';
import { detectDisplayMode, isIosDevice } from '../../pwa/register';

const props = defineProps<{
  db?: GaokaoDatabase;
}>();

// 测试环境 db prop 可能被 Vue 深度代理，Dexie 需要 toRaw 取回原始实例
const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

const rows = ref<DownloadOverviewRow[]>([]);
const message = ref('');
const loading = ref(true);
const usageText = ref('未知');
const quotaText = ref('未知');
const displayText = ref('');

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const statusText = (row: DownloadOverviewRow): string => {
  if (!row.packValid) return '课程数据异常，待重新下载';
  if (row.jobStatus === 'ready') return '已就绪';
  if (row.jobStatus === 'needs-download') return '待重新下载';
  if (row.assetCount === 0) return '无需媒体资源';
  if (row.jobStatus === 'downloading') return '下载中';
  if (row.jobStatus === 'verifying') return '校验中';
  if (row.jobStatus === 'failed') return '下载失败';
  if (!row.resourcesReady) return '待重新下载';
  return '未下载';
};

const needsAction = (row: DownloadOverviewRow): boolean => {
  if (!row.packValid) return true;
  if (row.jobStatus === 'needs-download' || row.jobStatus === 'failed') return true;
  if (row.assetCount === 0) return false;
  return row.jobStatus !== 'ready' && row.jobStatus !== 'downloading' && row.jobStatus !== 'verifying';
};

const refresh = async (): Promise<void> => {
  try {
    rows.value = await collectDownloadOverview({ db: db.value });
    const storage = (globalThis.navigator as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }).storage;
    if (typeof storage?.estimate === 'function') {
      const { usage = 0, quota = 0 } = await storage.estimate();
      usageText.value = formatBytes(usage);
      quotaText.value = quota > 0 ? formatBytes(quota) : '未知';
    }
  } catch {
    message.value = '下载状态读取失败，请稍后再试';
  }
};

const downloadingKey = ref('');

const download = async (row: DownloadOverviewRow): Promise<void> => {
  // R8：in-flight 锁，防止并发双击竞态
  if (downloadingKey.value !== '') return;
  downloadingKey.value = row.packId + '@' + row.version;
  message.value = '';
  try {
    const result = await startPackDownload({
      db: db.value,
      packId: row.packId,
      version: row.version,
      onStateChange: (state) => {
        message.value = state === 'downloading' ? '正在下载音频资源…' : '正在校验资源摘要…';
      },
    });
    if (!result.ok) {
      message.value = result.error.messageZh;
    } else {
      message.value = '音频下载完成，可以离线练习。';
    }
  } catch {
    message.value = '下载未完成，请重试';
  }
  downloadingKey.value = '';
  await refresh();
};

onMounted(async () => {
  try {
    // 启动对账（D09）：缓存缺失标 needs-download，不自动重下
    await reconcileInstalledPacks({ db: db.value });
  } catch {
    // 对账失败不阻塞页面浏览
  }
  const mode = detectDisplayMode();
  displayText.value = mode === 'standalone'
    ? '当前以独立应用窗口运行。'
    : mode === 'toplevel'
      ? '当前从主屏幕打开。'
      : '当前在浏览器标签页中运行；添加到主屏幕后可全屏独立使用。';
  await refresh();
  loading.value = false;
});
</script>

<template>
  <section class="downloads-page" aria-labelledby="downloads-title">
    <h2 id="downloads-title" class="downloads-heading">课程下载</h2>
    <p class="downloads-storage">本机存储：已用 {{ usageText }} / 配额 {{ quotaText }}</p>
    <p class="downloads-display">{{ displayText }}</p>
    <p v-if="isIosDevice()" class="downloads-ios">
      iPhone / iPad 安装说明：在 Safari 中点「分享」→「添加到主屏幕」。安装前建议先备份学习记录；
      从主屏幕打开后如发现记录为空，可在备份页导入此前导出的备份。
    </p>
    <!-- B1（D10）：空库（未装内容）时 /settings、/backup 唯一全局可达入口 -->
    <p class="downloads-backup-entry">
      <router-link to="/backup">备份与恢复（导入备份）</router-link>
    </p>
    <p v-if="message !== ''" class="downloads-message" role="status">{{ message }}</p>
    <p v-if="!loading && rows.length === 0" class="downloads-empty" role="status">还没有已安装的课程，请先在课程列表准备内容。</p>
    <ul class="download-list">
      <li v-for="row in rows" :key="row.packId + '@' + row.version" class="download-row">
        <span class="download-title">{{ row.titleZh }}</span>
        <span class="download-version">v{{ row.version }}</span>
        <span class="download-status">{{ statusText(row) }}</span>
        <span class="download-size">{{ row.assetCount > 0 ? formatBytes(row.totalBytes) : '—' }}</span>
        <button
          v-if="needsAction(row)"
          type="button"
          class="download-start"
          :disabled="downloadingKey !== ''"
          @click="download(row)"
        >
          {{ row.jobStatus === 'failed' || row.jobStatus === 'needs-download' || !row.packValid ? '重试下载' : '下载资源' }}
        </button>
        <span v-else-if="row.assetCount > 0" class="download-ready-mark">资源已就绪</span>
      </li>
    </ul>
    <router-link class="downloads-back" to="/today">返回今日</router-link>
  </section>
</template>
