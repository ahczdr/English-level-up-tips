<template>
  <section class="settings-page">
    <h1>设置</h1>
    <p class="settings-hint">
      浏览器存储可能因清理缓存或系统策略被清除，本应用不承诺数据永久保存；重要进度请定期在备份页导出。
    </p>

    <div class="settings-block">
      <h2>练习偏好</h2>
      <label class="settings-row">
        <span>年级</span>
        <select v-model="grade" data-testid="settings-grade" @change="savePrefs">
          <option value="">暂不选择</option>
          <option value="高一">高一</option>
          <option value="高二">高二</option>
          <option value="高三">高三</option>
        </select>
      </label>
      <label class="settings-row">
        <span>目标</span>
        <input v-model="goal" data-testid="settings-goal" type="text" placeholder="例如：补基础词汇" @change="savePrefs" />
      </label>
      <fieldset class="settings-row settings-minutes">
        <legend>默认练习时长</legend>
        <button
          v-for="option in minuteOptions"
          :key="option"
          type="button"
          class="duration-option"
          :aria-pressed="minutes === option"
          @click="setMinutes(option)"
        >
          {{ option }} 分钟
        </button>
      </fieldset>
      <label class="settings-row">
        <span>音效</span>
        <input v-model="soundEnabled" type="checkbox" @change="savePrefs" />
      </label>
      <label class="settings-row">
        <span>学习日时区</span>
        <select v-model="timeZone" @change="savePrefs">
          <option value="Asia/Shanghai">Asia/Shanghai（北京时间）</option>
          <option value="UTC">UTC</option>
        </select>
      </label>
      <p class="settings-note">学习日按所选时区从本地 04:00 划分（P03）。</p>
    </div>

    <div class="settings-block">
      <h2>关于与版本</h2>
      <div class="settings-release-info" data-testid="release-info">
        <template v-if="releaseInfo">
          <p class="settings-note">应用版本：{{ releaseInfo.appVersion }} · 构建：{{ releaseInfo.buildSha }}</p>
          <ul class="settings-pack-versions">
            <li v-for="pack in releaseInfo.packs" :key="pack.id">{{ pack.id }} @ {{ pack.version }} · sha256 {{ pack.sha256 }}</li>
          </ul>
        </template>
        <template v-else-if="releaseInfoFailed">
          <p class="settings-note">应用版本：{{ readBuildInfo().appVersion }} · 构建：{{ readBuildInfo().buildSha }}</p>
          <p class="settings-note">版本信息不可用（离线或目录获取失败）</p>
        </template>
        <p v-else class="settings-note">正在读取版本信息…</p>
      </div>
    </div>

    <div class="settings-block">
      <h2>备份与恢复</h2>
      <p class="settings-note">导出包含学习记录与课程快照（不含音频文件）；换设备或重装前请先导出。</p>
      <router-link class="settings-backup-link" to="/backup">前往备份与恢复</router-link>
    </div>

    <div class="settings-block settings-danger">
      <h2>清除学习数据</h2>
      <p class="settings-note">清除练习会话、作答、曝光、复习状态、写作与成就；已安装课程保留。此操作与「清除缓存」无关，且不可恢复。</p>
      <button v-if="clearStep === 0" type="button" class="settings-clear-btn" @click="clearStep = 1">清除学习数据…</button>
      <template v-else>
        <button type="button" class="settings-clear-btn settings-clear-confirm" @click="clearLearning">确认清除（不可恢复）</button>
        <button type="button" class="settings-clear-cancel" @click="clearStep = 0">取消</button>
      </template>
      <p v-if="message" class="settings-message" role="status">{{ message }}</p>
    </div>

    <router-link class="settings-back" to="/today">返回今日</router-link>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRaw } from 'vue';
import { db as defaultDb, type GaokaoDatabase } from '../../data/db';
import { loadPersonalSettings, savePersonalSettings, type PersonalSettings } from '../../services/settings';
import { collectReleaseInfo, readBuildInfo, type ReleaseCatalog, type ReleaseInfo } from '../../services/release-info';

const props = defineProps<{ db?: GaokaoDatabase }>();

const grade = ref<PersonalSettings['grade'] | ''>('');
const goal = ref('');
const minutes = ref<PersonalSettings['defaultMinutes']>(10);
const minuteOptions: Array<PersonalSettings['defaultMinutes']> = [5, 10, 15, 25];
const soundEnabled = ref(true);
const timeZone = ref('Asia/Shanghai');
const clearStep = ref(0);
const message = ref('');
const releaseInfo = ref<ReleaseInfo | null>(null);
const releaseInfoFailed = ref(false);

const loadReleaseInfo = async (): Promise<void> => {
  try {
    const response = await fetch('/content-catalog.json');
    if (!response.ok) throw new Error('catalog ' + String(response.status));
    const catalog = (await response.json()) as ReleaseCatalog;
    releaseInfo.value = collectReleaseInfo({
      appVersion: globalThis.__APP_VERSION__ ?? 'unversioned',
      buildSha: globalThis.__BUILD_SHA__ ?? 'unversioned',
      catalog,
    });
  } catch {
    // T16：获取失败如实显示，不伪造版本号
    releaseInfoFailed.value = true;
  }
};

const resolveDb = (): GaokaoDatabase => toRaw(props.db) ?? defaultDb;

const loadPrefs = async (): Promise<void> => {
  const settings = await loadPersonalSettings(resolveDb());
  grade.value = settings.grade ?? '';
  goal.value = settings.goal ?? '';
  minutes.value = settings.defaultMinutes;
  soundEnabled.value = settings.sound;
  timeZone.value = settings.timeZone === 'UTC' ? 'UTC' : 'Asia/Shanghai';
};

const setMinutes = (option: PersonalSettings['defaultMinutes']): void => {
  minutes.value = option;
  void savePrefs();
};

const savePrefs = async (): Promise<void> => {
  const db = resolveDb();
  const current = await loadPersonalSettings(db);
  await savePersonalSettings(db, {
    ...current,
    grade: grade.value === '' ? null : grade.value,
    goal: goal.value.trim() === '' ? null : goal.value.trim(),
    defaultMinutes: minutes.value,
    sound: soundEnabled.value,
    timeZone: timeZone.value,
  });
  message.value = '偏好已保存';
};

const clearLearning = async (): Promise<void> => {
  const db = resolveDb();
  try {
    await db.transaction('rw', [db.sessions, db.attempts, db.exposures, db.reviewStates, db.drafts, db.writingVersions, db.achievements, db.settings], async () => {
      await Promise.all([
        db.sessions.clear(),
        db.attempts.clear(),
        db.exposures.clear(),
        db.reviewStates.clear(),
        db.drafts.clear(),
        db.writingVersions.clear(),
        db.achievements.clear(),
      ]);
      const settingRows = await db.settings.toArray();
      for (const row of settingRows) {
        if (row.id.startsWith('today-session:')) await db.settings.delete(row.id);
      }
    });
    message.value = '学习数据已清除（课程与音频保留）';
  } catch {
    message.value = '清除失败，数据未受影响，请重试';
  }
  clearStep.value = 0;
};

onMounted(() => {
  void loadPrefs();
  void loadReleaseInfo();
});

onBeforeUnmount(() => {
  clearStep.value = 0;
});
</script>