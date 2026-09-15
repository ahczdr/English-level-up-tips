<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { useRouter } from 'vue-router';
import type { CoursePack, Unit } from '../../content/types';
import { db as defaultDb } from '../../data/db';
import type { GaokaoDatabase } from '../../data/db';
import { createSession } from '../../services/learning';
import { loadPersonalSettings, type PersonalSettings } from '../../services/settings';
import { downloadPackAssets, installPreviewPacks } from '../../services/content';
import AppButton from '../../components/AppButton.vue';

interface UnitOption {
  key: string
  packId: string
  packVersion: string
  packTitle: string
  unit: Unit
  itemCount: number
  totalSeconds: number
  draft: boolean
  needsDownload: boolean
}

const props = defineProps<{
  db?: GaokaoDatabase;
}>();

const router = useRouter();
const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

const units = ref<UnitOption[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
const starting = ref(false);
const status = ref('');
const preparing = ref(false);
const downloadingAudio = ref(false);
const selectedKey = ref<string | null>(null);
const minutes = ref<PersonalSettings['defaultMinutes']>(10);
const profileId = ref('gaokao-common-training-v1');
const minuteOptions: Array<PersonalSettings['defaultMinutes']> = [5, 10, 15, 25];

const selectedUnit = computed(() => units.value.find((unit) => unit.key === selectedKey.value) ?? null);

const loadUnits = async (): Promise<void> => {
  loading.value = true;
  try {
    const records = (await db.value.packs.toArray()).filter((record) => record.status === 'installed');
    const options: UnitOption[] = [];
    for (const record of records) {
      const pack = record.pack as CoursePack;
      const needsDownload = !record.resourcesReady;
      for (const unit of pack.units) {
        const items = pack.items.filter((item) => unit.itemIds.includes(item.id));
        if (items.length === 0 && needsDownload) continue;
        options.push({
          key: `${pack.id}@${pack.version}:${unit.id}`,
          packId: pack.id,
          packVersion: pack.version,
          packTitle: pack.titleZh,
          unit,
          itemCount: items.length,
          totalSeconds: items.reduce((sum, item) => sum + item.estimatedSeconds, 0),
          draft: pack.status !== 'published',
          needsDownload,
        });
      }
    }
    units.value = options;
    loadFailed.value = false;
  } catch {
    units.value = [];
    // CR24：加载失败与空态分开呈现，不给「暂无可用课程」误导
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  try {
    const settings = await loadPersonalSettings(db.value);
    minutes.value = settings.defaultMinutes;
    profileId.value = settings.profileId;
  } catch {
    minutes.value = 10;
  }
  await loadUnits();
  if (!loadFailed.value && units.value.length === 0) {
    status.value = '暂无可用课程，完整课程下载将在后续版本提供。';
  }
});

// CR24：失败态的重试入口
const retryLoad = async (): Promise<void> => {
  status.value = '';
  await loadUnits();
  if (!loadFailed.value && units.value.length === 0) {
    status.value = '暂无可用课程，完整课程下载将在后续版本提供。';
  }
};

const prepareContent = async (): Promise<void> => {
  if (preparing.value) return;
  preparing.value = true;
  status.value = '';
  const result = await installPreviewPacks({ db: db.value });
  if (result.ok) {
    await loadUnits();
    if (units.value.length === 0) {
      status.value = `暂无可用课程：新增安装 ${result.value.installed} 个，已安装 ${result.value.skippedExisting} 个，未通过校验 ${result.value.rejected} 个。`;
    } else {
      status.value = `内容准备完成：新增安装 ${result.value.installed} 个课程包，已安装 ${result.value.skippedExisting} 个，未通过校验 ${result.value.rejected} 个。`;
    }
  } else {
    status.value = `内容准备失败：${result.error.messageZh}`;
  }
  preparing.value = false;
};

const selectUnit = (option: UnitOption): void => {
  selectedKey.value = option.key;
};

const downloadUnitAudio = async (): Promise<void> => {
  const unit = selectedUnit.value;
  if (!unit || downloadingAudio.value) return;
  downloadingAudio.value = true;
  status.value = '';
  try {
    const result = await downloadPackAssets({ db: db.value, packId: unit.packId, version: unit.packVersion });
    if (!result.ok) {
      status.value = result.error.messageZh;
      return;
    }
    await loadUnits();
    status.value = '音频下载完成，可以开始练习。';
  } finally {
    downloadingAudio.value = false;
  }
};

const startPractice = async (): Promise<void> => {
  const unit = selectedUnit.value;
  if (!unit || preparing.value || starting.value) return;
  // CR22：createSession 无同日复用，双击会创建两个会话，需 in-flight 闸
  starting.value = true;
  try {
    if (unit.needsDownload) {
      status.value = '请先下载本课程的音频素材。';
      return;
    }
    const result = await createSession({
      db: db.value,
      unitId: unit.unit.id,
      minutes: minutes.value,
      profileId: profileId.value,
    });
    if (!result.ok) {
      status.value = result.error.messageZh;
      return;
    }
    if (result.value.kind === 'empty') {
      status.value = result.value.messageZh;
      return;
    }
    await router.push(`/session/${result.value.session.id}`);
  } finally {
    starting.value = false;
  }
};
</script>

<template>
  <section
    class="learn-page"
    aria-labelledby="learn-title"
  >
    <h2 id="learn-title">
      课程
    </h2>
    <p
      v-if="loading"
      role="status"
      class="learn-status"
    >
      正在加载课程…
    </p>
    <template v-else-if="loadFailed">
      <p
        role="alert"
        class="learn-status"
      >
        课程读取失败，请重试。
      </p>
      <div class="learn-actions">
        <AppButton @click="retryLoad">重新加载</AppButton>
      </div>
    </template>
    <p
      v-if="status !== ''"
      role="status"
      class="learn-status"
    >
      {{ status }}
    </p>
    <button
      v-for="option in units"
      :key="option.key"
      type="button"
      class="unit-card"
      :aria-pressed="selectedKey === option.key"
      @click="selectUnit(option)"
    >
      <span class="unit-title">{{ option.unit.titleZh }}</span>
      <span class="unit-meta">
        {{ option.packTitle }} · 共 {{ option.itemCount }} 题 · 约
        {{ Math.max(1, Math.round(option.totalSeconds / 60)) }} 分钟
      </span>
      <span
        v-if="option.draft"
        class="draft-badge"
      >预览内容 · 未审核</span>
    </button>
    <fieldset
      v-if="units.length > 0"
      class="duration-field"
    >
      <legend>练习时长</legend>
      <button
        v-for="option in minuteOptions"
        :key="option"
        type="button"
        class="duration-option"
        :aria-pressed="minutes === option"
        @click="minutes = option"
      >
        {{ option }} 分钟
      </button>
    </fieldset>
    <div
      v-if="units.length > 0"
      class="learn-actions"
    >
      <AppButton
        v-if="selectedUnit?.needsDownload"
        :disabled="downloadingAudio"
        @click="downloadUnitAudio"
      >
        {{ downloadingAudio ? '下载中…' : '下载音频' }}
      </AppButton>
      <AppButton
        :disabled="selectedUnit === null || selectedUnit.needsDownload || starting"
        @click="startPractice"
      >
        开始练习
      </AppButton>
    </div>
    <div
      v-else-if="!loading && !loadFailed"
      class="learn-actions"
    >
      <AppButton
        :disabled="preparing"
        @click="prepareContent"
      >
        准备课程内容
      </AppButton>
    </div>
  </section>
</template>
