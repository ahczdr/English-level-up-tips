<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue';
import { useRouter } from 'vue-router';
import { db as defaultDb } from '../../data/db';
import type { GaokaoDatabase } from '../../data/db';
import {
  DEFAULT_PERSONAL_SETTINGS,
  loadPersonalSettings,
  savePersonalSettings,
  type GradeLevel,
  type PersonalSettings,
} from '../../services/settings';
import AppButton from '../../components/AppButton.vue';

const props = defineProps<{
  db?: GaokaoDatabase;
}>();

const router = useRouter();
const db = computed<GaokaoDatabase>(() => {
  const candidate: GaokaoDatabase = props.db ?? defaultDb;
  return toRaw(candidate) as GaokaoDatabase;
});

const grade = ref<GradeLevel | ''>('');
const goal = ref('');
const minutes = ref<PersonalSettings['defaultMinutes']>(DEFAULT_PERSONAL_SETTINGS.defaultMinutes);
const minuteOptions: Array<PersonalSettings['defaultMinutes']> = [5, 10, 15, 25];
const saved = ref(false);
const saveFailed = ref('');

onMounted(async () => {
  try {
    const settings = await loadPersonalSettings(db.value);
    grade.value = settings.grade ?? '';
    goal.value = settings.goal ?? '';
    minutes.value = settings.defaultMinutes;
  } catch {
    saved.value = false;
  }
});

const save = async (): Promise<void> => {
  const settings: PersonalSettings = {
    ...DEFAULT_PERSONAL_SETTINGS,
    grade: grade.value === '' ? null : grade.value,
    goal: goal.value.trim() === '' ? null : goal.value.trim(),
    defaultMinutes: minutes.value,
  };
  try {
    await savePersonalSettings(db.value, settings);
    saved.value = true;
    saveFailed.value = '';
  } catch {
    saveFailed.value = '设置保存失败，请重试';
  }
};

const skip = async (): Promise<void> => {
  await router.push('/today');
};
</script>

<template>
  <section
    class="onboarding-page"
    aria-labelledby="onboarding-title"
  >
    <h2 id="onboarding-title">
      学习设置
    </h2>
    <p class="onboarding-note">
      起点练习尚未提供：当前样本不足，暂按基础层级（G0）安排，不输出能力等级。
    </p>
    <label class="onboarding-field">
      年级
      <select v-model="grade">
        <option value="">暂不选择</option>
        <option value="高一">高一</option>
        <option value="高二">高二</option>
        <option value="高三">高三</option>
      </select>
    </label>
    <label class="onboarding-field">
      目标
      <input
        v-model="goal"
        type="text"
        placeholder="例如：补基础词汇"
      >
    </label>
    <fieldset class="onboarding-field">
      <legend>默认时长</legend>
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
    <p
      v-if="saved"
      role="status"
      class="onboarding-saved"
    >
      设置已保存到本机。
    </p>
    <p
      v-if="saveFailed !== ''"
      role="alert"
      class="onboarding-error"
    >
      {{ saveFailed }}
    </p>
    <div class="onboarding-actions">
      <AppButton @click="save">
        保存设置
      </AppButton>
      <AppButton
        variant="ghost"
        @click="skip"
      >
        跳过
      </AppButton>
    </div>
  </section>
</template>
