<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { hasActiveSessionFlag, setupPwa } from '../pwa/register';
import { reconcileInstalledPacks } from '../services/downloads';
import { collectMistakes } from '../services/mistakes';
import { loadPersonalSettings } from '../services/settings';
import { e2eNow } from '../data/e2e-clock';
import { studyDayFor } from '../domain/calendar';
import { db as defaultDb } from '../data/db';

// T12（D09）：SW 有新版本先提示；用户点击才激活，活动会话不自动重载。
const route = useRoute();
// 练习页隐藏底部导航，保持答题专注；其余页面常驻，学生单手可达
const showBottomNav = computed(() => !route.path.startsWith('/session'));
const navItems = [
  { to: '/today', label: '今日', icon: '🏠', aria: '前往今日练习' },
  { to: '/learn', label: '课程', icon: '📚', aria: '前往课程列表' },
  { to: '/review', label: '复习', icon: '🔁', aria: '前往复习列表' },
  { to: '/progress', label: '成长', icon: '🌱', aria: '前往成长记录' },
];
const updateReady = ref(false);
// 复习角标：到期复习数 + 未订正错题数（路由切换时刷新，保持轻量）
const reviewBadge = ref(0);
const refreshReviewBadge = async (): Promise<void> => {
  try {
    const settings = await loadPersonalSettings(defaultDb);
    const today = studyDayFor(e2eNow(), settings.timeZone);
    const due = (await defaultDb.reviewStates.where('profileId').equals(settings.profileId).toArray())
      .filter((row) => row.dueDay <= today).length;
    const open = (await collectMistakes(defaultDb, settings.profileId)).filter((row) => !row.corrected).length;
    reviewBadge.value = due + open;
  } catch {
    reviewBadge.value = 0;
  }
};
const { applyUpdate } = setupPwa({
  onNeedRefresh: () => {
    updateReady.value = true;
  },
});
const updateHint = ref('');
// R2（D09）：应用启动即对账一次，避免仅访问下载页时才校准 resourcesReady
onMounted(() => {
  void reconcileInstalledPacks({ db: defaultDb }).catch(() => undefined);
  void refreshReviewBadge();
});
watch(() => route.path, () => { void refreshReviewBadge(); });
const dismissUpdate = (): void => {
  updateReady.value = false;
  updateHint.value = '';
};
const confirmUpdate = (): void => {
  if (hasActiveSessionFlag()) {
    updateHint.value = '正在练习中，练习结束后再更新，避免中途重载。';
    return;
  }
  applyUpdate();
};
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-brand">
        <span class="app-brand-mark" aria-hidden="true">英</span>
        <div>
          <h1>高考英语练习</h1>
          <p>每天一点，稳稳提分</p>
        </div>
      </div>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <nav v-if="showBottomNav" class="bottom-nav" aria-label="主导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="bottom-nav-item"
        :class="{ 'bottom-nav-item-active': route.path.startsWith(item.to) }"
        :aria-label="item.aria"
      >
        <span class="bottom-nav-icon" aria-hidden="true">{{ item.icon }}</span>
        <span class="bottom-nav-label">{{ item.label }}</span>
        <span
          v-if="item.to === '/review' && reviewBadge > 0"
          class="bottom-nav-badge"
          aria-label="待复习与待订正共 {{ reviewBadge }} 项"
        >{{ reviewBadge > 99 ? '99+' : reviewBadge }}</span>
      </RouterLink>
    </nav>
    <div v-if="updateReady" class="sw-update-banner" role="status">
      <span class="sw-update-text">新版本已就绪，可在方便时更新。</span>
      <button type="button" class="sw-update-apply" @click="confirmUpdate">更新</button>
      <button type="button" class="sw-update-dismiss" @click="dismissUpdate">稍后</button>
      <span v-if="updateHint" class="sw-update-hint">{{ updateHint }}</span>
    </div>
  </div>
</template>
