<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterView } from 'vue-router';
import { hasActiveSessionFlag, setupPwa } from '../pwa/register';
import { reconcileInstalledPacks } from '../services/downloads';
import { db as defaultDb } from '../data/db';

// T12（D09）：SW 有新版本先提示；用户点击才激活，活动会话不自动重载。
const { applyUpdate } = setupPwa({
  onNeedRefresh: () => {
    updateReady.value = true;
  },
});
const updateReady = ref(false);
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
      <h1>高考英语练习</h1>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <div v-if="updateReady" class="sw-update-banner" role="status">
      <span class="sw-update-text">新版本已就绪，可在方便时更新。</span>
      <button type="button" class="sw-update-apply" @click="confirmUpdate">更新</button>
      <button type="button" class="sw-update-dismiss" @click="dismissUpdate">稍后</button>
      <span v-if="updateHint" class="sw-update-hint">{{ updateHint }}</span>
    </div>
  </div>
</template>
