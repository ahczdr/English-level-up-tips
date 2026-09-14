<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import AppButton from './AppButton.vue';

const props = defineProps<{
  bytes: ArrayBuffer | null;
  mime: string;
  speed: number;
}>();

const emit = defineEmits<{
  (e: 'replay'): void;
  (e: 'speed', value: number): void;
  (e: 'ended'): void;
}>();

// eslint no-undef 不放行 HTMLAudioElement 全局类型，用结构窄化
interface MediaElement {
  play?: () => Promise<void>;
  pause?: () => void;
  currentTime?: number;
  playbackRate?: number;
}

const audioRef = ref<MediaElement | null>(null);
const playing = ref(false);
const errorZh = ref('');
const objectUrl = ref<string | null>(null);

const applyRate = (): void => {
  const audio = audioRef.value;
  if (audio && typeof audio.playbackRate === 'number') audio.playbackRate = props.speed;
};

watch(
  () => props.bytes,
  (bytes) => {
    errorZh.value = '';
    playing.value = false;
    if (objectUrl.value !== null) {
      globalThis.URL.revokeObjectURL(objectUrl.value);
      objectUrl.value = null;
    }
    if (bytes !== null && typeof globalThis.URL.createObjectURL === 'function') {
      objectUrl.value = globalThis.URL.createObjectURL(new globalThis.Blob([bytes], { type: props.mime }));
    }
    applyRate();
  },
  { immediate: true },
);

watch(() => props.speed, () => applyRate());

const startPlayback = async (): Promise<void> => {
  const audio = audioRef.value;
  if (!audio?.play) return;
  try {
    await audio.play();
    playing.value = true;
    errorZh.value = '';
  } catch {
    playing.value = false;
    errorZh.value = '浏览器阻止了音频播放，请点击重试。';
  }
};

const toggle = (): void => {
  const audio = audioRef.value;
  if (playing.value) {
    audio?.pause?.();
    playing.value = false;
    return;
  }
  void startPlayback();
};

const replay = (): void => {
  const audio = audioRef.value;
  if (audio && typeof audio.currentTime === 'number') audio.currentTime = 0;
  emit('replay');
  void startPlayback();
};

const setSpeed = (value: number): void => {
  const audio = audioRef.value;
  if (audio && typeof audio.playbackRate === 'number') audio.playbackRate = value;
  emit('speed', value);
};

const onEnded = (): void => {
  playing.value = false;
  emit('ended');
};

// 离开题组即停止播放并释放资源
onBeforeUnmount(() => {
  audioRef.value?.pause?.();
  if (objectUrl.value !== null) globalThis.URL.revokeObjectURL(objectUrl.value);
});
</script>

<template>
  <div class="audio-player">
    <p
      v-if="bytes === null"
      class="audio-missing"
    >
      音频未下载
    </p>
    <template v-else>
      <audio
        ref="audioRef"
        :src="objectUrl ?? undefined"
        preload="auto"
        @ended="onEnded"
      />
      <div class="audio-controls">
        <AppButton @click="toggle">
          {{ playing ? '暂停' : '播放' }}
        </AppButton>
        <AppButton
          variant="secondary"
          @click="replay"
        >
          重播
        </AppButton>
        <AppButton
          variant="ghost"
          :aria-pressed="speed === 0.75"
          @click="setSpeed(0.75)"
        >
          0.75×
        </AppButton>
        <AppButton
          variant="ghost"
          :aria-pressed="speed === 1"
          @click="setSpeed(1)"
        >
          1×
        </AppButton>
      </div>
      <p
        v-if="errorZh !== ''"
        role="alert"
        class="audio-error"
      >
        {{ errorZh }}
        <AppButton
          variant="secondary"
          @click="startPlayback"
        >
          重试
        </AppButton>
      </p>
    </template>
  </div>
</template>
