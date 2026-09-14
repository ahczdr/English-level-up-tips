<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost';
  }>(),
  { variant: 'primary' },
);
</script>

<template>
  <button
    type="button"
    class="app-button"
    :class="`app-button-${variant}`"
  >
    <slot />
  </button>
</template>
