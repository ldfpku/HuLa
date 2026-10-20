<template>
  <div class="voice-recorder-container">
    <!-- 录音状态显示 -->
    <div class="voice-recorder-main">
      <!-- 录音状态文字 -->
      <div class="voice-status">
        <div v-if="!isRecording && !audioBlob && !isProcessing">
          <span class="text-#909090 flex-y-center gap-6px select-none">
            {{ t('message.voice_recorder.tap_prefix') }}
            <svg class="size-14px color-#034fbc"><use href="#voice"></use></svg>
            {{ t('message.voice_recorder.tap_suffix') }}
          </span>
        </div>

        <div v-if="isRecording" class="status-recording">
          <div class="recording-animation">
            <div class="pulse-dot"></div>
          </div>
          <span>{{ formatTime(recordingTime) }} {{ t('message.voice_recorder.recording') }}</span>
        </div>

        <div v-if="!isRecording && isProcessing" class="status-processing">
          <div class="processing-animation">
            <div class="loading-spinner"></div>
          </div>
          <span>{{ t('message.voice_recorder.processing') }}</span>
        </div>

        <div v-if="!isRecording && audioBlob && !isProcessing" class="status-completed">
          <div class="playback-controls">
            <button
              :title="isPlaying ? t('tooltip.pause') : t('tooltip.play')"
              :aria-label="isPlaying ? t('tooltip.pause') : t('tooltip.play')"
              @click="togglePlayback"
              class="play-btn">
              <svg v-if="!isPlaying" viewBox="0 0 24 24">
                <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <path fill="currentColor" d="M14,19H18V5H14M6,19H10V5H6V19Z" />
              </svg>
            </button>
            <span>{{ formatTime(recordingDuration) }}</span>
          </div>
        </div>
      </div>

      <!-- 录音控制按钮 -->
      <div class="voice-controls">
        <!-- 未录音状态 -->
        <div v-if="!isRecording && !audioBlob && !isProcessing" class="controls-idle">
          <div
            role="button"
            :title="t('tooltip.hold_to_record')"
            :aria-label="t('tooltip.hold_to_record')"
            @mousedown="startRecording"
            @mouseup="stopRecording"
            @mouseleave="stopRecording"
            @touchstart="startRecording"
            @touchend="stopRecording"
            class="record-btn">
            <svg><use href="#voice"></use></svg>
          </div>
          <div
            role="button"
            :title="t('tooltip.cancel')"
            :aria-label="t('tooltip.cancel')"
            @click="handleCancel"
            class="cancel-btn">
            <svg><use href="#close"></use></svg>
          </div>
        </div>

        <!-- 录音中状态 -->
        <div v-if="isRecording" class="controls-recording">
          <div
            role="button"
            :title="t('tooltip.stop_recording')"
            :aria-label="t('tooltip.stop_recording')"
            @click="stopRecording"
            class="stop-btn">
            <svg viewBox="0 0 24 24">
              <path fill="currentColor" d="M18,18H6V6H18V18Z" />
            </svg>
          </div>
          <div
            role="button"
            :title="t('tooltip.cancel_recording')"
            :aria-label="t('tooltip.cancel_recording')"
            @click="cancelRecording"
            class="cancel-record-btn">
            <svg><use href="#close"></use></svg>
          </div>
        </div>

        <!-- 处理中状态 -->
        <div v-if="!isRecording && isProcessing" class="controls-processing">
          <!-- <div @click="handleCancel" class="cancel-btn">
            <svg><use href="#close"></use></svg>
          </div> -->
        </div>

        <!-- 录音完成状态 -->
        <div v-if="!isRecording && audioBlob && !isProcessing" class="controls-completed">
          <div
            role="button"
            :title="t('tooltip.re_record')"
            :aria-label="t('tooltip.re_record')"
            @click="reRecord"
            class="refresh-btn">
            <svg><use href="#refresh"></use></svg>
          </div>
          <div
            role="button"
            :title="t('tooltip.send')"
            :aria-label="t('tooltip.send')"
            @click="handleSend"
            class="send-btn"
            :disabled="sending">
            <svg v-if="!sending"><use href="#send"></use></svg>
            <div v-else class="loading-spinner"></div>
          </div>
          <div
            role="button"
            :title="t('tooltip.cancel')"
            :aria-label="t('tooltip.cancel')"
            @click="handleCancel"
            class="cancel-btn">
            <svg><use href="#close"></use></svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVoiceRecordRust } from '@/hooks/useVoiceRecordRust'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// 事件定义
const emit = defineEmits<{
  cancel: []
  send: [voiceData: any]
}>()

// 录音状态
const audioBlob = ref<Blob | null>(null)
const recordingDuration = ref(0)
const sending = ref(false)
const localAudioPath = ref<string>('')

// 播放状态
const isPlaying = ref(false)
const isProcessing = ref(false)
const audioElement = ref<HTMLAudioElement | null>(null)

// 语音录制功能
const {
  isRecording,
  recordingTime,
  startRecording: startRecord,
  stopRecording: stopRecord,
  cancelRecording: cancelRecord,
  formatTime
} = useVoiceRecordRust({
  onStart: () => {
    console.log('开始录音')
  },
  onStop: (blob, duration, localPath) => {
    console.log('录音结束', duration, '本地路径:', localPath)
    audioBlob.value = blob
    recordingDuration.value = duration
    localAudioPath.value = localPath
    isProcessing.value = false
    createAudioElement()
  },
  onError: () => {
    window.$message?.error(t('message.voice_recorder.error'))
    isProcessing.value = false
  }
})

// 开始录音
const startRecording = async () => {
  await startRecord()
}

// 停止录音
const stopRecording = async () => {
  if (isRecording.value) {
    isProcessing.value = true
  }
  await stopRecord()
}

// 重置录音状态
const resetRecordingState = () => {
  // 清理音频播放器
  if (audioElement.value) {
    audioElement.value.pause()
    if (audioElement.value.src) {
      URL.revokeObjectURL(audioElement.value.src)
    }
    audioElement.value = null
  }

  // 重置所有状态
  audioBlob.value = null
  recordingDuration.value = 0
  localAudioPath.value = ''
  isPlaying.value = false
  isProcessing.value = false
}

// 取消录音
const cancelRecording = () => {
  cancelRecord()
  audioBlob.value = null
  recordingDuration.value = 0
  isProcessing.value = false
}

// 重新录制
const reRecord = () => {
  resetRecordingState()
}

// 创建音频元素用于播放
const createAudioElement = () => {
  if (audioBlob.value) {
    const url = URL.createObjectURL(audioBlob.value)
    audioElement.value = new Audio(url)

    audioElement.value.addEventListener('ended', () => {
      isPlaying.value = false
    })
  }
}

// 切换播放状态
const togglePlayback = () => {
  if (audioElement.value) {
    if (isPlaying.value) {
      audioElement.value.pause()
    } else {
      audioElement.value.play()
    }
    isPlaying.value = !isPlaying.value
  }
}

// 发送语音
const handleSend = async () => {
  if (!audioBlob.value || !localAudioPath.value) {
    console.log('🎤 缺少音频数据，退出发送')
    return
  }

  try {
    sending.value = true

    // 直接使用本地路径，不需要重新上传文件
    // 这样和其他文件发送逻辑保持一致，都是先缓存到本地再处理
    const voiceData = {
      localPath: localAudioPath.value,
      size: audioBlob.value.size,
      duration: recordingDuration.value,
      filename: `voice_${Date.now()}.mp3`,
      type: 'audio/mp3'
    }

    console.log('🎤 发送语音数据:', voiceData)
    emit('send', voiceData)

    // 发送后立即重置状态，避免下次打开时还显示这条录音
    resetRecordingState()
  } catch (error) {
    console.error('🎤 发送语音失败:', error)
  } finally {
    sending.value = false
  }
}

// 取消/关闭
const handleCancel = () => {
  // 清理资源
  if (audioElement.value) {
    audioElement.value.pause()
    URL.revokeObjectURL(audioElement.value.src)
  }

  emit('cancel')
}

// 生命周期
onUnmounted(() => {
  if (audioElement.value) {
    audioElement.value.pause()
    URL.revokeObjectURL(audioElement.value.src)
  }
})
</script>

<style scoped lang="scss">
@mixin base-control-button($dark-bg, $bg) {
  @apply flex-center size-36px text-#fff cursor-pointer rounded-full;
  background-color: $bg;
  [data-theme='dark'] & {
    background-color: $dark-bg;
  }
}

.voice-recorder-container {
  @apply flex flex-col relative w-full h-110px bg-[--bg-color] rounded-8px;
}

.voice-recorder-main {
  @apply flex flex-col items-center justify-center h-full gap-22px;
}

.voice-status {
  @apply text-(14px [--text-color] center) max-h-24px;

  .status-recording {
    @apply flex-y-center gap-8px text-#034fbc select-none;

    .recording-animation {
      position: relative;
      .pulse-dot {
        @apply size-8px bg-#034fbc rounded-full;
        animation: pulse 1.5s infinite;
      }
    }
  }

  .status-processing {
    @apply flex-y-center gap-8px text-[--chat-text-color] select-none;

    .processing-animation {
      position: relative;
      .loading-spinner {
        @apply size-12px rounded-full;
        border: 2px solid transparent;
        border-top: 2px solid var(--chat-text-color);
        animation: spin 1s linear infinite;
      }
    }
  }

  .status-completed {
    .playback-controls {
      @apply flex-y-center gap-8px;

      .play-btn {
        @apply flex-center size-30px bg-inherit border-none cursor-pointer text-#034fbc;

        svg {
          @apply size-16px;
        }

        &:hover {
          opacity: 0.8;
        }
      }
    }
  }
}

.voice-controls {
  @apply flex-center gap-16px;

  .controls-idle,
  .controls-recording,
  .controls-processing,
  .controls-completed {
    @apply flex-y-center gap-12px;
  }

  svg {
    @apply size-18px;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .record-btn {
    @include base-control-button(#034fbc80, #034fbc);
  }

  .stop-btn {
    @include base-control-button(#e74c3c96, #e74c3c);
  }

  .refresh-btn {
    @include base-control-button(#f39c1280, #f39c12);
  }

  .send-btn {
    @include base-control-button(#034fbc80, #034fbc);

    .loading-spinner {
      @apply size-16px rounded-full;
      border: 2px solid transparent;
      border-top: 2px solid currentColor;
      animation: spin 1s linear infinite;
    }
  }

  .cancel-btn,
  .cancel-record-btn {
    @include base-control-button(#95a5a640, #95a5a690);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
