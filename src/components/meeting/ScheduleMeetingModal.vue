<template>
  <n-modal
    v-model:show="visible"
    :mask-closable="!submitting"
    class="rounded-8px"
    :class="created ? 'w-420px' : 'w-680px'">
    <div
      class="bg-[--bg-popover] box-border p-[18px_22px] flex flex-col gap-16px text-[--text-color] max-h-[calc(100vh-4rem)] overflow-y-auto"
      :class="created ? 'w-420px' : 'w-680px'">
      <div class="flex items-center justify-between">
        <span class="text-15px font-600">{{ created ? '会议已预约' : '预约视频会议' }}</span>
        <svg class="size-12px cursor-pointer select-none" @click="visible = false">
          <title>{{ t('tooltip.close') }}</title>
          <use href="#close"></use>
        </svg>
      </div>

      <template v-if="!created">
        <n-form label-placement="left" label-width="72" :show-feedback="false" class="flex flex-col gap-12px">
          <n-form-item label="主题">
            <n-input v-model:value="title" :maxlength="100" :placeholder="defaultTitle" clearable />
          </n-form-item>
          <n-form-item label="开始时间">
            <n-date-picker
              v-model:value="startAt"
              type="datetime"
              format="yyyy-MM-dd HH:mm"
              :is-date-disabled="isPastDate"
              class="w-full" />
          </n-form-item>
          <n-form-item label="时长">
            <n-select v-model:value="duration" :options="durationOptions" />
          </n-form-item>
          <n-form-item label="参会人">
            <n-select
              v-model:value="inviteUids"
              multiple
              filterable
              clearable
              :max-tag-count="6"
              :options="directoryOptions"
              :loading="!membersReady"
              placeholder="添加参会人，可按姓名或邮箱搜索" />
          </n-form-item>
          <n-form-item label="邮件邀请">
            <n-flex vertical :size="4">
              <n-switch v-model:value="sendMail" />
              <span class="text-12px text-[--chat-text-color]">
                从你的邮箱给参会人发送邀请，附带日历邀请，对方的 Outlook、系统日历或手机日历可直接接受。
              </span>
            </n-flex>
          </n-form-item>
        </n-form>

        <!-- 日程助手：参会人的忙碌时段，冲突标红，可一键采用推荐时段 -->
        <SchedulingAssistant
          v-if="startAt"
          :participants="availability?.participants ?? []"
          :suggestions="availability?.suggestions ?? []"
          :work-hours="availability?.workHours ?? { start: 540, end: 1080 }"
          :start-at="startAt"
          :duration-minutes="duration"
          :self-uid="selfUid"
          :excluded-count="availability?.excluded.length ?? 0"
          :loading="availabilityLoading"
          @pick="startAt = $event"
          @change-day="changeDay" />
        <span v-if="availabilityError" class="text-12px text-[--chat-text-color]">{{ availabilityError }}</span>

        <n-flex justify="end">
          <n-button secondary :disabled="submitting" @click="visible = false">取消</n-button>
          <n-button color="#034fbc" text-color="#ffffff" :loading="submitting" @click="submit">预约</n-button>
        </n-flex>
      </template>

      <template v-else>
        <div class="text-14px leading-24px">
          <p class="m-0 font-600">{{ created.title }}</p>
          <p class="m-0 text-[--chat-text-color]">{{ createdTime }}</p>
          <p class="m-0 text-[--chat-text-color]">
            {{ created.invited.length ? `邀请邮件已发给 ${created.invited.length} 人` : '未发送邀请邮件' }}
          </p>
          <p class="m-0 text-12px break-all text-[--link-color] select-text">{{ created.url }}</p>
        </div>
        <n-flex justify="end">
          <n-button secondary type="error" :loading="cancelling" @click="cancel">取消会议</n-button>
          <n-button secondary @click="copyLink">复制链接</n-button>
          <n-button secondary @click="addToCalendar(created.id)">加入日历</n-button>
          <n-button color="#034fbc" text-color="#ffffff" @click="joinNow">进入会议</n-button>
        </n-flex>
      </template>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import SchedulingAssistant from '@/components/meeting/SchedulingAssistant.vue'
import { useMeeting } from '@/hooks/useMeeting'
import { useContactStore } from '@/stores/contacts'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import { getMeetingAvailability, type MeetingAvailability, type MeetingCreateResult } from '@/utils/MeetingRequestUtils'
import { moveToDay, startOfLocalDay } from '@/utils/MeetingScheduleUtils'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  /** 从哪个会话预约；群聊默认邀请全体成员，单聊邀请对方 */
  roomId: string
  /** 主题的默认值，如群名 */
  defaultTitle?: string
}>()

const visible = defineModel<boolean>('show', { default: false })

const { startMeeting, openMeeting, addToCalendar, confirmCancelMeeting } = useMeeting()

const nextHalfHour = () => {
  const date = new Date()
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60)
  return date.getTime()
}

const title = ref('')
const startAt = ref<number | null>(nextHalfHour())
const duration = ref(60)
const sendMail = ref(true)
const submitting = ref(false)
const cancelling = ref(false)
const created = ref<MeetingCreateResult | null>(null)

const contactStore = useContactStore()
const groupStore = useGroupStore()
const userStore = useUserStore()
const selfUid = computed(() => userStore.userInfo?.uid ?? '')

/** 参会人（不含自己）。打开时先按会话成员填好，之后可增删 */
const inviteUids = ref<string[]>([])
const membersReady = ref(false)
const availability = ref<MeetingAvailability | null>(null)
const availabilityLoading = ref(false)
const availabilityError = ref('')
/** 一次查 7 天，换日期时在这个范围内就不用重新查 */
const AVAILABILITY_DAYS = 7
const timeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
})()

/** 组织通讯录（全体在职账号） */
const directoryOptions = computed(() =>
  contactStore.contactsList
    .filter((item) => item.uid !== selfUid.value)
    .map((item) => {
      const info = groupStore.getUserInfo(item.uid)
      const name = info?.name || item.remark || item.uid
      const account = info?.account?.includes('@') ? info.account : ''
      return { label: account ? `${name}（${account}）` : name, value: item.uid }
    })
)

let requestSeq = 0
/** 最近一次查询用的参会人与时长，避免重复查询 */
let loadedKey = ''
const currentKey = () => `${[...inviteUids.value].sort().join(',')}|${duration.value}`
const loadAvailability = async (initial = false) => {
  if (!startAt.value) return
  const seq = ++requestSeq
  availabilityLoading.value = true
  availabilityError.value = ''
  try {
    const result = await getMeetingAvailability({
      // 刚打开时让服务端按会话成员查；之后按选中的参会人查
      ...(initial ? { roomId: props.roomId } : { userIds: inviteUids.value }),
      from: startOfLocalDay(startAt.value),
      days: AVAILABILITY_DAYS,
      durationMinutes: duration.value,
      timeZone
    })
    if (seq !== requestSeq) return
    availability.value = result
    if (initial) {
      inviteUids.value = result.participants.map((p) => p.uid).filter((uid) => uid !== selfUid.value)
      membersReady.value = true
    }
    loadedKey = currentKey()
  } catch (e) {
    if (seq !== requestSeq) return
    console.error('查询参会人日程失败:', e)
    availabilityError.value = '暂时查不到参会人的日程，仍可直接预约。'
    if (initial) membersReady.value = true
  } finally {
    if (seq === requestSeq) availabilityLoading.value = false
  }
}

/** 所选日期超出已查询的范围、参会人或时长变化时重新查询 */
const needsReload = () => {
  const data = availability.value
  if (!data || !startAt.value) return true
  const day = startOfLocalDay(startAt.value)
  return day < data.from || day + 24 * 3600_000 > data.to
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined
const scheduleReload = () => {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => void loadAvailability(), 300)
}

watch(
  () => [inviteUids.value.join(','), duration.value],
  () => {
    if (visible.value && membersReady.value && !created.value && currentKey() !== loadedKey) scheduleReload()
  }
)
watch(startAt, () => {
  if (visible.value && membersReady.value && !created.value && needsReload()) scheduleReload()
})

const changeDay = (offset: number) => {
  if (!startAt.value) return
  const next = moveToDay(startAt.value, startOfLocalDay(startAt.value) + offset * 24 * 3600_000 + 12 * 3600_000)
  startAt.value = Math.max(next, nextHalfHour())
}

const durationOptions = [15, 30, 45, 60, 90, 120, 180].map((minutes) => ({
  label: minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`,
  value: minutes
}))

const isPastDate = (timestamp: number) => timestamp < new Date().setHours(0, 0, 0, 0)

const createdTime = computed(() => {
  if (!created.value?.startsAt) return ''
  const start = new Date(created.value.startsAt)
  const end = new Date(created.value.startsAt + created.value.durationMinutes * 60_000)
  const time = (date: Date) => date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${start.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })} ${time(start)} - ${time(end)}`
})

watch(visible, (show) => {
  if (!show) return
  title.value = ''
  startAt.value = nextHalfHour()
  duration.value = 60
  sendMail.value = true
  created.value = null
  inviteUids.value = []
  membersReady.value = false
  availability.value = null
  void loadAvailability(true)
})

const submit = async () => {
  if (!startAt.value) {
    window.$message.warning('请选择开始时间')
    return
  }
  if (startAt.value < Date.now() - 60_000) {
    window.$message.warning('开始时间不能早于现在')
    return
  }
  submitting.value = true
  try {
    created.value = await startMeeting({
      roomId: props.roomId,
      title: title.value.trim() || undefined,
      startAt: new Date(startAt.value).toISOString(),
      durationMinutes: duration.value,
      // 参会人以表单为准；还没查到会话成员时不传，由服务端按会话成员邀请
      ...(membersReady.value ? { inviteUids: inviteUids.value } : {}),
      sendMail: sendMail.value
    })
  } catch (e) {
    console.error('预约会议失败:', e)
  } finally {
    submitting.value = false
  }
}

const copyLink = async () => {
  if (!created.value) return
  await navigator.clipboard.writeText(created.value.url)
  window.$message.success('会议链接已复制')
}

const cancel = () => {
  if (!created.value) return
  confirmCancelMeeting(created.value.id, {
    onStart: () => (cancelling.value = true),
    onDone: (cancelled) => {
      cancelling.value = false
      if (cancelled) visible.value = false
    }
  })
}

const joinNow = async () => {
  if (!created.value) return
  const id = created.value.id
  visible.value = false
  await openMeeting(id)
}
</script>
