<template>
  <!-- 手机单栏：回到列表（触控区 40px） -->
  <div
    data-testid="phone-back"
    role="button"
    class="flex-center size-40px flex-shrink-0 cursor-pointer color-[--text-color]"
    :aria-label="t('home.chat_header.back')"
    @click="closePhonePane">
    <svg
      class="size-22px"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { closePhonePane } from '@/hooks/usePhoneLayout'

const { t } = useI18n()
</script>
