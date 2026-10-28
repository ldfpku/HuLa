<template>
  <n-modal :show="show" :mask-closable="!busy" @update:show="handleShowChange">
    <section
      role="dialog"
      aria-modal="true"
      :aria-label="t('components.avatarPicker.title')"
      class="avatar-picker bg-[--bg-edit] rounded-8px p-20px box-border">
      <h2 class="text-16px text-[--text-color] mt-0 mb-16px">{{ t('components.avatarPicker.title') }}</h2>
      <div class="avatar-grid" role="group" :aria-label="t('components.avatarPicker.title')">
        <button
          v-for="avatar in AvatarUtils.DEFAULT_AVATARS"
          :key="avatar"
          type="button"
          class="avatar-option"
          :class="{ selected: avatar === selectedAvatar }"
          :aria-label="t('components.avatarPicker.option', { number: avatar })"
          :aria-pressed="avatar === selectedAvatar"
          :disabled="busy"
          @click="$emit('select', avatar)">
          <img :src="AvatarUtils.getAvatarUrl(avatar)" alt="" />
        </button>
      </div>
      <p v-if="busy" role="status" class="text-12px text-[--text-muted-color] mt-12px mb-0">
        {{ t('components.avatarPicker.saving') }}
      </p>
      <div class="flex justify-end gap-8px mt-16px">
        <n-button :disabled="busy" @click="$emit('update:show', false)">{{ t('components.common.cancel') }}</n-button>
        <n-button type="primary" :disabled="busy" @click="$emit('upload')">
          {{ t('components.avatarPicker.upload') }}
        </n-button>
      </div>
    </section>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { AvatarUtils } from '@/utils/AvatarUtils'

const props = defineProps<{ show: boolean; currentAvatar?: string; uid?: string; busy?: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [avatar: string]
  upload: []
}>()
const { t } = useI18n()
const selectedAvatar = computed(() =>
  AvatarUtils.DEFAULT_AVATARS.find(
    (avatar) => AvatarUtils.getAvatarUrl(avatar) === AvatarUtils.getAvatarUrl(props.currentAvatar, props.uid)
  )
)

const handleShowChange = (show: boolean) => {
  if (!props.busy) emit('update:show', show)
}
</script>

<style scoped>
.avatar-picker {
  width: min(480px, 94vw);
  max-height: 85vh;
  overflow: auto;
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(52px, 1fr));
  gap: 8px;
}

.avatar-option {
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.avatar-option.selected,
.avatar-option:focus-visible {
  border-color: var(--link-color);
  outline: none;
}

.avatar-option img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 50%;
}
</style>
