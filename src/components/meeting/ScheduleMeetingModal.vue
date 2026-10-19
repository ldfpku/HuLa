<template>
  <n-modal v-model:show="visible" :mask-closable="!submitting" class="w-420px rounded-8px">
    <div class="bg-[--bg-popover] w-420px box-border p-[18px_22px] flex flex-col gap-16px text-[--text-color]">
      <div class="flex items-center justify-between">
        <span class="text-15px font-600">{{ created ? '会议已预约' : '预约视频会议' }}</span>
        <svg class="size-12px cursor-pointer select-none" @click="visible = false">
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
          <n-form-item label="邮件邀请">
            <n-flex vertical :size="4">
              <n-switch v-model:value="sendMail" />
              <span class="text-12px text-[--chat-text-color]">
                从你的邮箱给本会话成员发送邀请，附带日历邀请，对方的 Outlook、系统日历或手机日历可直接接受。
              </span>
            </n-flex>
          </n-form-item>
        </n-form>

        <n-flex justify="end">
          <n-button secondary :disabled="submitting" @click="visible = false">取消</n-button>
          <n-button color="#034fbc" :loading="submitting" @click="submit">预约</n-button>
        </n-flex>
      </template>

      <template v-else>
        <div class="text-14px leading-24px">
          <p class="m-0 font-600">{{ created.title }}</p>
          <p class="m-0 text-[--chat-text-color]">{{ createdTime }}</p>
          <p class="m-0 text-[--chat-text-color]">
            {{ created.invited.length ? `邀请邮件已发给 ${created.invited.length} 人` : '未发送邀请邮件' }}
          </p>
          <p class="m-0 text-12px break-all text-#034fbc select-text">{{ created.url }}</p>
        </div>
        <n-flex justify="end">
          <n-button secondary @click="copyLink">复制链接</n-button>
          <n-button secondary @click="addToCalendar(created.id)">加入日历</n-button>
          <n-button color="#034fbc" @click="joinNow">进入会议</n-button>
        </n-flex>
      </template>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { useMeeting } from '@/hooks/useMeeting'
import type { MeetingCreateResult } from '@/utils/MeetingRequestUtils'

const props = defineProps<{
  /** 从哪个会话预约；群聊默认邀请全体成员，单聊邀请对方 */
  roomId: string
  /** 主题的默认值，如群名 */
  defaultTitle?: string
}>()

const visible = defineModel<boolean>('show', { default: false })

const { startMeeting, openMeeting, addToCalendar } = useMeeting()

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
const created = ref<MeetingCreateResult | null>(null)

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

const joinNow = async () => {
  if (!created.value) return
  const id = created.value.id
  visible.value = false
  await openMeeting(id)
}
</script>
