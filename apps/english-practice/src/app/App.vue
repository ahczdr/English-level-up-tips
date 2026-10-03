<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { hasActiveSessionFlag, setupPwa } from '../pwa/register';
import { reconcileInstalledPacks } from '../services/downloads';
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
const { applyUpdate } = setupPwa({
  onNeedRefresh: () => {
    updateReady.value = true;
  },
});
const updateHint = ref('');
// R2（D09）：应用启动即对账一次，避免仅访问下载页时才校准 resourcesReady
onMounted(() => {
  void reconcileInstalledPacks({ db: defaultDb }).catch(() => undefined);
});
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
