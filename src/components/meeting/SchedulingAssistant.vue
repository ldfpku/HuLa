<template>
  <div class="flex flex-col gap-8px text-[--text-color] select-none">
    <!-- 日期切换与结论 -->
    <div class="flex items-center justify-between gap-8px">
      <div class="flex items-center gap-6px">
        <n-button quaternary size="tiny" :disabled="!canGoBack" @click="emit('changeDay', -1)">
          <svg class="size-12px rotate-180"><use href="#right"></use></svg>
        </n-button>
        <span class="text-13px font-600 min-w-108px text-center">{{ formatDay(day) }}</span>
        <n-button quaternary size="tiny" @click="emit('changeDay', 1)">
          <svg class="size-12px"><use href="#right"></use></svg>
        </n-button>
      </div>
      <span v-if="loading && !participants.length" class="text-12px text-[--chat-text-color]">正在查询日程…</span>
      <span v-else-if="conflicts.length" class="text-12px text-#d03050" data-test="schedule-verdict">
        {{ participants.length }} 人中 {{ conflicts.length }} 人有冲突：{{ conflictNames }}
      </span>
      <span v-else-if="participants.length" class="text-12px text-#18a058" data-test="schedule-verdict">
        所有人都有空
      </span>
    </div>

    <!-- 时间轴：每人一行 -->
    <div
      class="relative border border-solid border-[--line-color] rounded-4px overflow-hidden"
      :class="{ 'opacity-60': loading }">
      <div class="flex h-20px text-11px text-[--chat-text-color] border-b border-b-solid border-[--line-color]">
        <div class="w-112px shrink-0"></div>
        <div class="relative flex-1">
          <span
            v-for="tick in ticks"
            :key="tick.label"
            class="absolute top-3px -translate-x-1/2"
            :style="{ left: `${tick.left}%` }">
            {{ tick.label }}
          </span>
        </div>
      </div>

      <div class="relative max-h-220px overflow-y-auto">
        <div
          v-for="person in participants"
          :key="person.uid"
          class="flex items-center h-30px border-b border-b-solid border-[--line-color] last:border-b-0">
          <div class="w-112px shrink-0 flex items-center gap-6px px-6px box-border">
            <n-avatar round :size="20" :src="avatarOf(person)" fallback-src="/avatar-light.svg" />
            <span class="truncate text-12px" :class="{ 'text-#d03050': conflicts.includes(person.uid) }">
              {{ person.uid === selfUid ? `${person.name}（我）` : person.name }}
            </span>
          </div>
          <div class="relative flex-1 h-full cursor-pointer" @click="pick($event)">
            <!-- 非工作时间 -->
            <div
              v-for="(off, index) in offHours"
              :key="index"
              class="absolute inset-y-0 bg-[rgba(128,128,128,0.10)]"
              :style="{ left: `${off.left}%`, width: `${off.width}%` }"></div>
            <!-- 忙碌 -->
            <n-popover v-for="(item, index) in layoutDay(person.busy, day)" :key="index" trigger="hover" :delay="150">
              <template #trigger>
                <div
                  class="absolute top-5px bottom-5px rounded-2px"
                  :class="isConflict(item.block) ? 'bg-#d03050' : 'bg-#034fbc opacity-55'"
                  :data-busy="isConflict(item.block) ? 'conflict' : 'busy'"
                  :style="{ left: `${item.left}%`, width: `${item.width}%` }"></div>
              </template>
              <span class="text-12px">{{ describeBusy(item.block) }}</span>
            </n-popover>
          </div>
        </div>

        <!-- 所选时段 -->
        <div
          v-if="selected"
          class="absolute top-0 bottom-0 pointer-events-none box-border border-2 border-solid rounded-2px"
          :class="
            conflicts.length ? 'border-#d03050 bg-[rgba(208,48,80,0.08)]' : 'border-#18a058 bg-[rgba(24,160,88,0.10)]'
          "
          data-test="schedule-selection"
          :style="{
            left: `calc(112px + (100% - 112px) * ${selected.left / 100})`,
            width: `calc((100% - 112px) * ${selected.width / 100})`
          }"></div>
      </div>
    </div>

    <!-- 图例 -->
    <div class="flex items-center gap-14px text-11px text-[--chat-text-color]">
      <span class="flex items-center gap-4px">
        <i class="inline-block size-10px rounded-2px bg-#034fbc opacity-55"></i>
        忙碌
      </span>
      <span class="flex items-center gap-4px">
        <i class="inline-block size-10px rounded-2px bg-#d03050"></i>
        冲突
      </span>
      <span class="flex items-center gap-4px">
        <i class="inline-block size-10px rounded-2px border-2 border-solid border-#18a058 box-border"></i>
        所选时段（无冲突）
      </span>
      <span class="flex items-center gap-4px">
        <i class="inline-block size-10px rounded-2px bg-[rgba(128,128,128,0.25)]"></i>
        非工作时间
      </span>
    </div>

    <!-- 推荐时段 -->
    <div class="flex items-start gap-8px">
      <span class="text-12px leading-24px shrink-0">推荐时段</span>
      <div class="flex flex-wrap gap-6px">
        <template v-if="suggestions.length">
          <n-button
            v-for="slot in suggestions"
            :key="slot.start"
            size="tiny"
            :secondary="slot.start !== startAt"
            :color="slot.start === startAt ? '#034fbc' : undefined"
            data-test="schedule-suggestion"
            @click="emit('pick', slot.start)">
            {{ formatSuggestion(slot.start, slot.end) }}
          </n-button>
        </template>
        <span v-else-if="!loading" class="text-12px leading-24px text-[--chat-text-color]">
          这几天工作时间内没有所有人都空闲的时段
        </span>
      </div>
    </div>

    <span v-if="excludedCount" class="text-11px text-[--chat-text-color]">
      {{ excludedCount }} 人不是在职公司账号，未显示日程。
    </span>
  </div>
</template>

<script setup lang="ts">
import { useGroupStore } from '@/stores/group'
import { AvatarUtils } from '@/utils/AvatarUtils'
import type { MeetingAvailabilityParticipant, MeetingBusyBlock } from '@/utils/MeetingRequestUtils'
import {
  TIMELINE_END_MINUTE,
  TIMELINE_START_MINUTE,
  axisPosition,
  conflictingUids,
  describeBusy,
  formatDay,
  formatSuggestion,
  layoutDay,
  overlaps,
  pickTime,
  startOfLocalDay
} from '@/utils/MeetingScheduleUtils'

const props = defineProps<{
  participants: MeetingAvailabilityParticipant[]
  suggestions: { start: number; end: number }[]
  /** 工作时间（当天零点起的分钟数） */
  workHours: { start: number; end: number }
  startAt: number
  durationMinutes: number
  selfUid: string
  excludedCount: number
  loading: boolean
}>()

const emit = defineEmits<{
  /** 选中一个开始时间 */
  pick: [start: number]
  /** 前一天 / 后一天 */
  changeDay: [offset: number]
}>()

const groupStore = useGroupStore()
const MINUTE = 60_000

const day = computed(() => startOfLocalDay(props.startAt))
const canGoBack = computed(() => day.value > startOfLocalDay(Date.now()))
const endAt = computed(() => props.startAt + props.durationMinutes * MINUTE)
const selected = computed(() => axisPosition(day.value, props.startAt, endAt.value))
const conflicts = computed(() => conflictingUids(props.participants, props.startAt, endAt.value))
const conflictNames = computed(() =>
  props.participants
    .filter((p) => conflicts.value.includes(p.uid))
    .map((p) => p.name)
    .join('、')
)

const isConflict = (block: MeetingBusyBlock) => overlaps(block, { start: props.startAt, end: endAt.value })

const span = TIMELINE_END_MINUTE - TIMELINE_START_MINUTE
const ticks = computed(() => {
  const list: { label: string; left: number }[] = []
  for (let minute = TIMELINE_START_MINUTE + 60; minute < TIMELINE_END_MINUTE; minute += 120) {
    list.push({ label: `${minute / 60}:00`, left: ((minute - TIMELINE_START_MINUTE) / span) * 100 })
  }
  return list
})

const offHours = computed(() => {
  const start = Math.max(props.workHours.start, TIMELINE_START_MINUTE)
  const end = Math.min(props.workHours.end, TIMELINE_END_MINUTE)
  const weekday = new Date(day.value).getDay()
  if (weekday === 0 || weekday === 6) return [{ left: 0, width: 100 }]
  return [
    { left: 0, width: ((start - TIMELINE_START_MINUTE) / span) * 100 },
    { left: ((end - TIMELINE_START_MINUTE) / span) * 100, width: ((TIMELINE_END_MINUTE - end) / span) * 100 }
  ]
})

const avatarOf = (person: MeetingAvailabilityParticipant) => {
  const avatar = groupStore.getUserInfo(person.uid)?.avatar
  return avatar ? AvatarUtils.getAvatarUrl(avatar) : person.avatar
}

const pick = (event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const start = pickTime(day.value, (event.clientX - rect.left) / rect.width)
  if (start < Date.now() - MINUTE) {
    window.$message.warning('不能选择已经过去的时间')
    return
  }
  emit('pick', start)
}
</script>
