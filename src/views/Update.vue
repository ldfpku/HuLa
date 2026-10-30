<template>
  <WindowsUpdate v-if="isWindows()" />
  <LegacyUpdate v-else />
</template>

<script setup lang="ts">
import { isWindows } from '@/utils/PlatformConstants'
import LegacyUpdate from './LegacyUpdate.vue'
import WindowsUpdate from './WindowsUpdate.vue'
</script>
