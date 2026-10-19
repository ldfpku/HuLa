<template>
  <!-- 通知样式窗口 (接收方且未接听) -->
  <div
    v-if="isReceiver && !isCallAccepted"
    class="w-360px h-full bg-white dark:bg-gray-800 flex-y-center px-12px select-none">
    <!-- 用户头像 -->
    <div class="relative mr-12px">
      <n-avatar
        :size="56"
        :src="avatarSrc"
        :color="themes.content === ThemeEnum.DARK ? '' : '#fff'"
        :fallback-src="themes.content === ThemeEnum.DARK ? '/avatar-dark.svg' : '/avatar-light.svg'"
        class="rounded-12px shadow-md" />
      <!-- 通话类型指示器 -->
      <div class="absolute -bottom-2px -right-2px w-20px h-20px rounded-full bg-blue-500 flex-center shadow-lg">
        <svg class="size-14px color-#fff">
          <use :href="callType === CallTypeEnum.VIDEO ? '#video-one' : '#phone-telephone'"></use>
        </svg>
      </div>
    </div>

    <!-- 用户信息和状态 -->
    <div class="flex-1 min-w-0">
      <div class="text-15px font-semibold text-gray-900 dark:text-white mb-12px truncate">
        {{ remoteUserInfo?.name || t('message.call_window.unknown_user') }}
      </div>
      <div class="text-12px text-gray-500 dark:text-gray-400 flex items-center">
        <div class="w-6px h-6px rounded-full bg-#034fbc mr-6px animate-pulse"></div>
        {{ t('message.call_window.incoming') }} ·
        {{
          callType === CallTypeEnum.VIDEO ? t('message.call_window.video_call') : t('message.call_window.voice_call')
        }}
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="flex gap-16px mr-8">
      <!-- 拒绝按钮 -->
      <div
        @click="hangUp(CallResponseStatus.REJECTED)"
        class="size-40px rounded-full bg-#d5304f hover:bg-#d5304f flex-center cursor-pointer shadow-lg">
        <svg class="color-#fff size-20px">
          <use href="#PhoneHangup"></use>
        </svg>
      </div>
      <!-- 接听按钮 -->
      <div
        @click="acceptCall"
        class="size-40px rounded-full bg-#034fbc hover:bg-#034fbc flex-center cursor-pointer shadow-lg">
        <svg class="color-#fff size-20px">
          <use href="#phone-telephone-entity"></use>
        </svg>
      </div>
    </div>
  </div>

  <!-- 正常通话窗口 -->
  <div v-else data-tauri-drag-region class="h-full flex flex-col select-none relative bg-#161616">
    <!-- 背景羽化模糊层 -->
    <div
      :style="{
        backgroundImage: `url(${avatarSrc})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }"
      class="absolute inset-0 blur-xl opacity-40"></div>
    <!-- 深色遮罩 -->
    <div class="absolute inset-0 bg-black/20"></div>

    <!-- 窗口控制栏 -->
    <ActionBar
      v-if="!isMobileDevice"
      ref="actionBarRef"
      class="relative z-10"
      :top-win-label="WebviewWindow.getCurrent().label"
      :shrink="false" />

    <!-- 主要内容区域 -->
    <div
      :class="[
        'relative z-10 flex flex-col min-h-0 flex-1',
        isMobileDevice ? 'p-0' : 'px-8px pt-6px',
        !isMobileDevice || callType !== CallTypeEnum.VIDEO ? 'items-center justify-center' : ''
      ]">
      <!-- 对方共享的屏幕：铺满内容区，视频通话时对方摄像头缩成小窗，点小窗互换 -->
      <div
        v-if="showRemoteScreen"
        data-testid="remote-screen"
        :class="isMobileDevice ? 'rounded-none' : 'rounded-8px'"
        class="absolute inset-0 z-40 bg-black overflow-hidden"
        :style="isMobileDevice ? {} : { left: '8px', right: '8px', top: '6px' }">
        <video
          ref="screenMainVideoRef"
          autoplay
          playsinline
          :class="isScreenOnMain ? 'object-contain' : 'object-cover scale-x-[-1]'"
          class="w-full h-full bg-black"></video>
        <RemoteControlSurface
          v-if="controlRole === 'controlling' && isScreenOnMain"
          :video="screenMainVideoRef"
          @input="sendRemoteInput" />
        <div
          v-if="controlRole === 'controlling'"
          data-testid="rc-controlling"
          class="absolute left-12px top-12px flex items-center gap-8px rounded-full bg-#034fbc px-12px py-4px text-12px text-#fff">
          <span>{{ t('message.call_window.rc_controlling', { name: remoteUserInfo?.name || '' }) }}</span>
          <span v-if="!isScreenOnMain">{{ t('message.call_window.rc_swap_hint') }}</span>
          <span
            class="cursor-pointer rounded-full bg-white/20 hover:bg-white/30 px-10px py-2px"
            @click="stopControlling()">
            {{ t('message.call_window.rc_stop_control') }}
          </span>
        </div>
        <div v-else class="absolute left-12px top-12px rounded-full bg-black/60 px-12px py-4px text-12px text-#fff">
          {{ t('message.call_window.remote_sharing', { name: remoteUserInfo?.name || '' }) }}
          <span v-if="connectionStatus === RTCCallStatus.ACCEPT" class="ml-6px">{{ formattedCallDuration }}</span>
        </div>
        <div v-if="hasRemoteVideo && callType === CallTypeEnum.VIDEO" class="absolute right-8px top-12px group">
          <video
            ref="screenPipVideoRef"
            autoplay
            playsinline
            :class="[pipVideoSizeClass, isScreenOnMain ? 'object-cover scale-x-[-1]' : 'object-contain']"
            class="rounded-8px bg-black border-2 border-white cursor-pointer"
            :title="t('message.call_window.swap_view')"
            @click="isScreenOnMain = !isScreenOnMain"></video>
          <div
            class="absolute inset-0 flex-center opacity-0 group-hover:opacity-100 transition-opacity bg-black bg-opacity-30 rounded-8px pointer-events-none">
            <svg class="text-#fff size-20px">
              <use href="#switch"></use>
            </svg>
          </div>
        </div>
      </div>

      <!-- 自己正在共享时：通话窗口四周的绿色边框和共享画面预览（行业惯例的“正在共享”提示） -->
      <div
        v-if="isScreenSharing"
        data-testid="sharing-frame"
        class="fixed inset-0 z-60 pointer-events-none border-4px border-solid border-#12a150"></div>
      <div
        v-if="isScreenSharing && localScreenStream"
        data-testid="local-share-preview"
        class="absolute left-12px bottom-12px z-45 w-200px rounded-6px overflow-hidden border-3px border-solid border-#12a150 bg-black shadow-lg">
        <video ref="localSharePreviewRef" autoplay playsinline muted class="block w-full aspect-video object-contain"></video>
        <div class="px-8px py-3px text-11px text-#fff bg-#12a150 truncate">
          {{ t('message.call_window.share_preview') }}
        </div>
      </div>
      <!-- 正在被对方远程控制：醒目的红色提示条，随时可以停止 -->
      <div
        v-if="isBeingControlled"
        data-testid="rc-controlled"
        class="absolute top-12px left-1/2 -translate-x-1/2 z-50 flex items-center gap-10px rounded-full bg-#d5304f px-14px py-6px text-13px text-#fff shadow-lg">
        <div class="w-8px h-8px rounded-full bg-#fff animate-pulse"></div>
        <span>{{ t('message.call_window.rc_being_controlled', { name: remoteUserInfo?.name || '' }) }}</span>
        <span
          class="cursor-pointer rounded-full bg-white/20 hover:bg-white/30 px-10px py-2px"
          @click="stopBeingControlled()">
          {{ t('message.call_window.rc_stop_control') }}
        </span>
      </div>
      <!-- 已在确认框同意远程控制：浏览器内核要求由本人点击开始共享整个屏幕 -->
      <div
        v-else-if="awaitingShare"
        data-testid="rc-share-prompt"
        class="absolute top-12px left-1/2 -translate-x-1/2 z-50 flex items-center gap-10px rounded-full bg-#d5304f px-14px py-6px text-13px text-#fff shadow-lg">
        <span>{{ t('message.call_window.rc_share_prompt', { name: remoteUserInfo?.name || '' }) }}</span>
        <span class="cursor-pointer rounded-full bg-white px-10px py-2px text-#d5304f" @click="shareAndGrant()">
          {{ t('message.call_window.rc_share_start') }}
        </span>
        <span class="cursor-pointer opacity-80 hover:opacity-100" @click="cancelPendingShare()">
          {{ t('message.call_window.rc_share_cancel') }}
        </span>
      </div>
      <!-- 自己正在共享时的提示条 -->
      <div
        v-else-if="isScreenSharing"
        data-testid="local-sharing"
        class="absolute top-12px left-1/2 -translate-x-1/2 z-50 flex items-center gap-10px rounded-full bg-#12a150 px-14px py-6px text-13px text-#fff shadow-lg">
        <svg class="size-14px color-#fff">
          <use href="#screen-sharing"></use>
        </svg>
        <span>{{ sharingSelfLabel }}</span>
        <span
          class="cursor-pointer rounded-full bg-white/20 hover:bg-white/30 px-10px py-2px"
          @click="stopScreenShare()">
          {{ t('message.call_window.stop_share') }}
        </span>
      </div>
      <!-- 从聊天顶部“屏幕共享”发起：接通后请用户点一下开始（浏览器要求共享由点击触发） -->
      <div
        v-else-if="showSharePrompt"
        data-testid="share-prompt"
        class="absolute top-12px left-1/2 -translate-x-1/2 z-50 flex items-center gap-10px rounded-full bg-#034fbc px-14px py-6px text-13px text-#fff shadow-lg">
        <span>{{ t('message.call_window.share_prompt') }}</span>
        <span
          class="cursor-pointer rounded-full bg-white px-10px py-2px text-#034fbc"
          @click="((sharePromptDismissed = true), startScreenShare())">
          {{ t('message.call_window.share_screen') }}
        </span>
        <span class="cursor-pointer opacity-80 hover:opacity-100" @click="sharePromptDismissed = true">
          {{ t('message.call_window.share_later') }}
        </span>
      </div>
      <!-- 视频通话时显示视频 (只有在双方都开启视频时才显示) -->
      <div
        v-if="callType === CallTypeEnum.VIDEO && localStream && (isVideoEnabled || hasRemoteVideo)"
        class="w-full flex-1 relative min-h-0 overflow-hidden">
        <div
          v-if="!isMobileDevice && connectionStatus !== RTCCallStatus.ACCEPT"
          class="absolute inset-0 flex-center z-20">
          <div class="rounded-full bg-black/60 px-20px py-8px text-16px text-white">
            {{ callStatusText }}
          </div>
        </div>
        <!-- 主视频 -->
        <video
          ref="mainVideoRef"
          autoplay
          playsinline
          :class="[
            'w-full h-full scale-x-[-1] bg-black object-cover',
            isMobileDevice ? 'rounded-none' : 'rounded-8px'
          ]"></video>

        <!-- 画中画视频 -->
        <div :class="isMobileDevice ? 'top-100px' : 'top-12px'" class="absolute right-8px group z-30">
          <video
            ref="pipVideoRef"
            autoplay
            playsinline
            :class="pipVideoSizeClass"
            class="scale-x-[-1] rounded-8px bg-black object-cover border-2 border-white cursor-pointer"
            @click="toggleVideoLayout"></video>
          <!-- 切换提示 -->
          <div
            class="absolute inset-0 flex-center opacity-0 group-hover:opacity-100 transition-opacity bg-black bg-opacity-30 rounded-8px pointer-events-none">
            <svg class="text-#fff size-20px">
              <use href="#switch"></use>
            </svg>
          </div>
        </div>

        <!-- 底部控制按钮悬浮层（仅移动端） -->
        <div
          v-if="isMobileDevice"
          class="absolute inset-x-0 bottom-0 z-30 px-24px pb-24px pointer-events-none"
          :style="{
            background: 'linear-gradient(180deg, rgba(15, 15, 15, 0) 0%, rgba(15, 15, 15, 0.88) 100%)',
            paddingBottom: 'calc(24px + env(safe-area-inset-bottom))'
          }">
          <!-- 通话时长 -->
          <div v-if="connectionStatus === RTCCallStatus.ACCEPT" class="pb-16px text-center pointer-events-none">
            <div class="inline-block rounded-full bg-black/50 px-16px py-6px text-14px text-#fff">
              {{ formattedCallDuration }}
            </div>
          </div>

          <div class="flex-center gap-24px pointer-events-auto">
            <!-- 静音按钮 -->
            <div class="flex-center">
              <div
                @click="toggleMute"
                class="size-44px rounded-full flex-center cursor-pointer"
                :class="!isMuted ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
                <svg class="size-16px color-#fff">
                  <use :href="!isMuted ? '#voice' : '#voice-off'"></use>
                </svg>
              </div>
            </div>

            <!-- 扬声器按钮 -->
            <div class="flex-center">
              <div
                @click="toggleSpeaker"
                class="size-44px rounded-full flex-center cursor-pointer"
                :class="isSpeakerOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
                <svg class="size-16px color-#fff">
                  <use :href="isSpeakerOn ? '#volume-notice' : '#volume-mute'"></use>
                </svg>
              </div>
            </div>

            <!-- 摄像头翻转按钮（仅移动端视频通话显示） -->
            <div v-if="callType === CallTypeEnum.VIDEO" class="flex-center">
              <div
                @click="switchCameraFacing"
                class="size-44px rounded-full flex-center cursor-pointer bg-gray-600 hover:bg-gray-500">
                <svg class="size-16px color-#fff">
                  <use href="#refresh"></use>
                </svg>
              </div>
            </div>

            <!-- 摄像头按钮 -->
            <div class="flex-center">
              <div
                @click="toggleVideo"
                class="size-44px rounded-full flex-center cursor-pointer"
                :class="isVideoEnabled ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
                <svg class="size-16px color-#fff">
                  <use :href="isVideoEnabled ? '#video-one' : '#monitor-off'"></use>
                </svg>
              </div>
            </div>

            <!-- 挂断按钮 -->
            <div class="flex-center">
              <div
                @click="hangUp()"
                class="size-44px rounded-full bg-#d5304f60 hover:bg-#d5304f80 flex-center cursor-pointer">
                <svg class="size-16px color-#fff">
                  <use href="#PhoneHangup"></use>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 语音通话或其他状态时显示头像 -->
      <div
        v-else
        :class="['mb-24px flex flex-col items-center', shouldCenterPreparingAvatar ? 'absolute-center' : 'relative']">
        <n-avatar
          :size="140"
          :src="avatarSrc"
          :color="themes.content === ThemeEnum.DARK ? '' : '#fff'"
          :fallback-src="themes.content === ThemeEnum.DARK ? '/avatar-dark.svg' : '/avatar-light.svg'"
          class="rounded-22px mb-16px" />

        <!-- 用户名 -->
        <div class="text-20px font-medium text-white mb-8px text-center">
          {{ remoteUserInfo?.name }}
        </div>

        <!-- 状态文本 -->
        <div class="text-14px text-gray-300 text-center">
          {{ callStatusText }}
        </div>
      </div>

      <!-- 通话时长 -->
      <div
        v-if="connectionStatus === RTCCallStatus.ACCEPT && (!isMobileDevice || callType !== CallTypeEnum.VIDEO)"
        class="inline-block rounded-full bg-black/50 px-16px py-6px text-16px text-gray-300 my-12px text-center">
        {{ formattedCallDuration }}
      </div>
    </div>

    <!-- 底部控制按钮（视频通话-桌面端） -->
    <div v-if="callType === CallTypeEnum.VIDEO && !isMobileDevice" class="relative z-10">
      <div class="py-14px flex-center gap-32px">
        <!-- 静音按钮 -->
        <div class="flex-col-x-center gap-8px w-80px">
          <div
            @click="toggleMute"
            class="size-44px rounded-full flex-center cursor-pointer"
            :class="!isMuted ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
            <svg class="size-16px color-#fff">
              <use :href="!isMuted ? '#voice' : '#voice-off'"></use>
            </svg>
          </div>
          <div class="text-12px text-gray-400 text-center">
            {{ !isMuted ? t('message.call_window.mic_on') : t('message.call_window.mic_off') }}
          </div>
        </div>

        <!-- 扬声器按钮 -->
        <div class="flex-col-x-center gap-8px w-80px">
          <div
            @click="toggleSpeaker"
            class="size-44px rounded-full flex-center cursor-pointer"
            :class="isSpeakerOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
            <svg class="size-16px color-#fff">
              <use :href="isSpeakerOn ? '#volume-notice' : '#volume-mute'"></use>
            </svg>
          </div>
          <div class="text-12px text-gray-400 text-center">
            {{ isSpeakerOn ? t('message.call_window.speaker_on') : t('message.call_window.speaker_off') }}
          </div>
        </div>

        <!-- 摄像头按钮 -->
        <div class="flex-col-x-center gap-8px w-80px">
          <div
            @click="toggleVideo"
            class="size-44px rounded-full flex-center cursor-pointer"
            :class="isVideoEnabled ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
            <svg class="size-16px color-#fff">
              <use :href="isVideoEnabled ? '#video-one' : '#monitor-off'"></use>
            </svg>
          </div>
          <div class="text-12px text-gray-400 text-center">
            {{ isVideoEnabled ? t('message.call_window.camera_disable') : t('message.call_window.camera_enable') }}
          </div>
        </div>

        <!-- 视频背景板 -->
        <VideoBackgroundPicker :loading="isBackgroundLoading" />

        <!-- 共享屏幕按钮 -->
        <div v-if="!isMobileDevice" class="flex-col-x-center gap-8px w-80px">
          <div
            data-testid="screen-share-toggle"
            @click="toggleScreenShare"
            class="size-44px rounded-full flex-center"
            :class="[
              isScreenSharing ? 'bg-#034fbc hover:bg-#02409a' : 'bg-gray-600 hover:bg-gray-500',
              connectionStatus === RTCCallStatus.ACCEPT ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
            ]">
            <svg class="size-16px color-#fff">
              <use href="#screen-sharing"></use>
            </svg>
          </div>
          <div class="text-12px text-gray-400 text-center">
            {{ isScreenSharing ? t('message.call_window.stop_share') : t('message.call_window.share_screen') }}
          </div>
        </div>

        <!-- 远程控制按钮：请求控制对方电脑 / 等待对方同意 / 结束控制 -->
        <div v-if="!isMobileDevice" class="flex-col-x-center gap-8px w-80px">
          <div
            data-testid="rc-toggle"
            @click="toggleRemoteControl"
            class="size-44px rounded-full flex-center"
            :class="[
              controlRole !== 'idle' ? 'bg-#034fbc hover:bg-#02409a' : 'bg-gray-600 hover:bg-gray-500',
              connectionStatus === RTCCallStatus.ACCEPT ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
            ]"
            :title="remoteControlTitle">
            <svg class="size-16px color-#fff">
              <use href="#remote-control"></use>
            </svg>
          </div>
          <div class="text-12px text-gray-400 text-center">
            {{ remoteControlLabel }}
          </div>
        </div>

        <!-- 挂断按钮 -->
        <div class="flex-col-x-center gap-8px w-80px">
          <div
            @click="hangUp()"
            class="size-44px rounded-full bg-#d5304f60 hover:bg-#d5304f80 flex-center cursor-pointer">
            <svg class="size-16px color-#fff">
              <use href="#PhoneHangup"></use>
            </svg>
          </div>
          <div class="text-12px text-gray-400 text-center">{{ t('message.call_window.hangup') }}</div>
        </div>
      </div>
    </div>

    <!-- 底部控制按钮（语音通话） -->
    <div v-if="callType !== CallTypeEnum.VIDEO" class="relative z-10">
      <div :class="isMobileDevice ? 'pb-120px' : 'pb-30px'" class="flex-col-x-center">
        <!-- 上排按钮：静音、扬声器、摄像头 -->
        <div class="flex-center gap-40px mb-32px">
          <!-- 静音按钮 -->
          <div class="flex-col-x-center gap-8px w-80px">
            <div
              @click="toggleMute"
              class="size-44px rounded-full flex-center cursor-pointer"
              :class="!isMuted ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
              <svg class="size-16px color-#fff">
                <use :href="!isMuted ? '#voice' : '#voice-off'"></use>
              </svg>
            </div>
            <div v-if="!isMobileDevice" class="text-12px text-gray-400 text-center">
              {{ !isMuted ? t('message.call_window.mic_on') : t('message.call_window.mic_off') }}
            </div>
          </div>

          <!-- 扬声器按钮 -->
          <div class="flex-col-x-center gap-8px w-80px">
            <div
              @click="toggleSpeaker"
              class="size-44px rounded-full flex-center cursor-pointer"
              :class="isSpeakerOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-#d5304f60 hover:bg-#d5304f80'">
              <svg class="size-16px color-#fff">
                <use :href="isSpeakerOn ? '#volume-notice' : '#volume-mute'"></use>
              </svg>
            </div>
            <div v-if="!isMobileDevice" class="text-12px text-gray-400 text-center">
              {{ isSpeakerOn ? t('message.call_window.speaker_on') : t('message.call_window.speaker_off') }}
            </div>
          </div>

          <!-- 共享屏幕按钮 -->
          <div v-if="!isMobileDevice" class="flex-col-x-center gap-8px w-80px">
            <div
              data-testid="screen-share-toggle"
              @click="toggleScreenShare"
              class="size-44px rounded-full flex-center"
              :class="[
                isScreenSharing ? 'bg-#034fbc hover:bg-#02409a' : 'bg-gray-600 hover:bg-gray-500',
                connectionStatus === RTCCallStatus.ACCEPT ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              ]">
              <svg class="size-16px color-#fff">
                <use href="#screen-sharing"></use>
              </svg>
            </div>
            <div class="text-12px text-gray-400 text-center">
              {{ isScreenSharing ? t('message.call_window.stop_share') : t('message.call_window.share_screen') }}
            </div>
          </div>

          <!-- 远程控制按钮：请求控制对方电脑 / 等待对方同意 / 结束控制 -->
          <div v-if="!isMobileDevice" class="flex-col-x-center gap-8px w-80px">
            <div
              data-testid="rc-toggle"
              @click="toggleRemoteControl"
              class="size-44px rounded-full flex-center"
              :class="[
                controlRole !== 'idle' ? 'bg-#034fbc hover:bg-#02409a' : 'bg-gray-600 hover:bg-gray-500',
                connectionStatus === RTCCallStatus.ACCEPT ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              ]"
              :title="remoteControlTitle">
              <svg class="size-16px color-#fff">
                <use href="#remote-control"></use>
              </svg>
            </div>
            <div class="text-12px text-gray-400 text-center">
              {{ remoteControlLabel }}
            </div>
          </div>
        </div>

        <!-- 下排按钮：挂断 -->
        <div class="flex-x-center">
          <div
            @click="hangUp()"
            class="size-66px rounded-full bg-#d5304f60 hover:bg-#d5304f80 flex-center cursor-pointer">
            <svg class="size-24px color-#fff">
              <use href="#PhoneHangup"></use>
            </svg>
          </div>
        </div>
      </div>
    </div>
  </div>

  <audio ref="remoteAudioRef" autoplay playsinline style="display: none"></audio>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { primaryMonitor } from '@tauri-apps/api/window'
import { info } from '@tauri-apps/plugin-log'
import { useRoute } from 'vue-router'
import type ActionBar from '@/components/windows/ActionBar.vue'
import { CallTypeEnum, RTCCallStatus, ThemeEnum } from '@/enums'
import { useRemoteControl } from '@/hooks/useRemoteControl'
import { useShareIndicator } from '@/hooks/useShareIndicator'
import { useWebRtc } from '@/hooks/useWebRtc'
import type { RemoteInput } from '@/utils/RemoteControlUtils'
import RemoteControlSurface from './components/RemoteControlSurface.vue'
import VideoBackgroundPicker from './components/VideoBackgroundPicker.vue'
import { useVideoBackgroundStore } from '@/stores/videoBackground'
import { useSettingStore } from '@/stores/setting'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { isDesktop, isMac, isMobile, isWindows } from '@/utils/PlatformConstants'
import { invokeSilently } from '@/utils/TauriInvokeHandler'
import router from '@/router'
import { useGroupStore } from '@/stores/group'
import { CallResponseStatus } from '../../services/wsType'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)
const route = useRoute()

const resolveCallType = (value?: string | null): CallTypeEnum => {
  const numeric = Number(value)
  return numeric === CallTypeEnum.VIDEO ? CallTypeEnum.VIDEO : CallTypeEnum.AUDIO
}

const remoteUserId = (route.query.remoteUserId as string) || ''
const roomId = (route.query.roomId as string) || ''
const callType = resolveCallType(route.query.callType as string | null)
// 是否是接受方，true 代表接受方
const isReceiver = route.query.isIncoming === 'true'
const shouldAutoAccept = isReceiver && route.query.autoAccept === '1'
// 从聊天顶部“屏幕共享”发起的通话
const wantsScreenShare = !isReceiver && route.query.shareScreen === '1'
const isMobileDevice = isMobile()

if ((!roomId || !remoteUserId) && isMobileDevice) {
  router.replace('/mobile/message')
}
const {
  localStream,
  remoteStream,
  handleCallResponse,
  callDuration,
  connectionStatus,
  sendRtcCall2VideoCallResponse,
  toggleMute: toggleMuteWebRtc,
  toggleVideo: toggleVideoWebRtc,
  switchCameraFacing,
  isVideoEnabled,
  pauseBell,
  playBell,
  stopBell,
  startBell,
  startScreenShare,
  stopScreenShare,
  isScreenSharing,
  remoteScreenStream,
  isRemoteScreenSharing,
  localScreenStream,
  isControlChannelOpen,
  sendControlMessage,
  sendInputMessage,
  onControlMessage,
  applyVideoBackground,
  isBackgroundLoading
} = useWebRtc(roomId, remoteUserId, callType, isReceiver)
const remoteAudioRef = ref<HTMLAudioElement>()
const isMuted = ref(false)
const isSpeakerOn = ref(true)
// 视频通话时默认开启视频，语音通话时默认关闭
const isVideoOn = ref(callType === CallTypeEnum.VIDEO)
const groupStore = useGroupStore()
// 获取远程用户信息
const remoteUserInfo = groupStore.getUserInfo(remoteUserId)!
// 视频元素引用
const mainVideoRef = ref<HTMLVideoElement>()
const pipVideoRef = ref<HTMLVideoElement>()
// ActionBar 组件引用
const actionBarRef = useTemplateRef<typeof ActionBar>('actionBarRef')
// 视频布局状态：false=远程视频主画面，true=本地视频主画面
const isLocalVideoMain = ref(true)
// 通话接听状态
const isCallAccepted = ref(!isReceiver)
// 对方共享屏幕时的两个画面
const screenMainVideoRef = ref<HTMLVideoElement>()
const screenPipVideoRef = ref<HTMLVideoElement>()
// true=屏幕在大画面，false=对方摄像头在大画面
const isScreenOnMain = ref(true)

const {
  controlRole,
  isBeingControlled,
  awaitingShare,
  shareAndGrant,
  cancelPendingShare,
  peerCaps,
  requestControl,
  stopControlling,
  stopBeingControlled,
  sendInput
} = useRemoteControl(
  {
    connectionStatus,
    isControlChannelOpen,
    isScreenSharing,
    isRemoteScreenSharing,
    localScreenStream,
    startScreenShare,
    stopScreenShare,
    sendControlMessage,
    sendInputMessage,
    onControlMessage
  },
  () => remoteUserInfo?.name || ''
)

// 从聊天顶部“远程协助”发起的通话：接通、通道打开后自动请求控制；对方能力消息迟迟不来（旧版）也照常请求，由请求给出提示
const wantsRemoteControl = !isReceiver && route.query.remoteControl === '1'
let autoControlDone = false
let autoControlTimer: ReturnType<typeof setTimeout> | null = null
const autoRequestControl = () => {
  if (autoControlDone) return
  autoControlDone = true
  if (autoControlTimer) clearTimeout(autoControlTimer)
  requestControl()
}
watch([connectionStatus, isControlChannelOpen, peerCaps], ([status, open, caps]) => {
  if (!wantsRemoteControl || autoControlDone || isMobileDevice) return
  if (status !== RTCCallStatus.ACCEPT || !open) return
  if (caps) autoRequestControl()
  else if (!autoControlTimer) autoControlTimer = setTimeout(autoRequestControl, 4000)
})
onUnmounted(() => {
  if (autoControlTimer) clearTimeout(autoControlTimer)
})

// 等本人点“开始共享”时把通话窗口提到前面，免得提示被挡住
watch(awaitingShare, (waiting) => {
  if (!waiting || isMobileDevice) return
  const win = WebviewWindow.getCurrent()
  void win
    .show()
    .then(() => win.setFocus())
    .catch(() => {})
})

// 桌面版：被共享的显示器四周加边框、屏幕顶部显示提示条
useShareIndicator(isScreenSharing, localScreenStream, stopScreenShare)

// 自己共享出去的画面预览，让共享方随时看到别人看到的内容
const localSharePreviewRef = ref<HTMLVideoElement>()
const sharingSelfLabel = computed(() => {
  const settings = localScreenStream.value?.getVideoTracks()[0]?.getSettings() as
    | (MediaTrackSettings & { displaySurface?: string })
    | undefined
  return settings?.displaySurface === 'window'
    ? t('message.call_window.sharing_window')
    : t('message.call_window.sharing_self')
})
watch([localSharePreviewRef, localScreenStream], ([el, stream]) => {
  if (el && el.srcObject !== stream) el.srcObject = stream
})

const toggleRemoteControl = () => {
  if (controlRole.value === 'idle') requestControl()
  else stopControlling()
}

const remoteControlLabel = computed(() => {
  if (controlRole.value === 'requesting') return t('message.call_window.rc_requesting')
  if (controlRole.value === 'controlling') return t('message.call_window.rc_stop_control')
  return t('message.call_window.rc_request')
})

const remoteControlTitle = computed(() =>
  controlRole.value === 'idle' ? t('message.call_window.rc_request_tip') : remoteControlLabel.value
)

const sendRemoteInput = (input: RemoteInput) => {
  sendInput(input)
}

const createSize = (width: number, height: number) => {
  const size = isWindows() ? new LogicalSize(width, height) : new PhysicalSize(width, height)
  return size
}

const hangUp = (status: CallResponseStatus = CallResponseStatus.DROPPED) => {
  // 立即停止铃声
  stopBell()
  if (isMobileDevice) {
    if (router.currentRoute.value.path === '/mobile/rtcCall') {
      if (window.history.length > 1) {
        router.back()
      } else {
        router.replace('/mobile/message')
      }
    } else {
      router.back()
    }
  }
  handleCallResponse(status)
}

const avatarSrc = computed(() => AvatarUtils.getAvatarUrl(remoteUserInfo.avatar as string))

const callStatusText = computed(() => {
  switch (connectionStatus.value) {
    case RTCCallStatus.CALLING:
      return t('message.call_window.status.calling')
    case RTCCallStatus.ACCEPT:
      return t('message.call_window.status.ongoing')
    case RTCCallStatus.END:
      return t('message.call_window.status.ended')
    default:
      return t('message.call_window.status.preparing')
  }
})

// 格式化通话时长
const formattedCallDuration = computed(() => {
  const duration = callDuration.value
  const hours = Math.floor(duration / 3600)
  const minutes = Math.floor((duration % 3600) / 60)
  const seconds = duration % 60

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  } else {
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
})

// 检测远程流是否有视频轨道且启用
const hasRemoteVideo = computed(() => {
  if (!remoteStream.value) return false
  const videoTracks = remoteStream.value.getVideoTracks()
  return videoTracks.length > 0 && videoTracks.some((track) => track.enabled)
})

// 对方正在共享且屏幕画面已到达
const showRemoteScreen = computed(
  () => isRemoteScreenSharing.value && !!remoteScreenStream.value?.getVideoTracks().length
)

const sharePromptDismissed = ref(false)
const showSharePrompt = computed(
  () =>
    wantsScreenShare &&
    !isMobileDevice &&
    !sharePromptDismissed.value &&
    !isScreenSharing.value &&
    connectionStatus.value === RTCCallStatus.ACCEPT
)

const toggleScreenShare = async () => {
  if (isScreenSharing.value) {
    await stopScreenShare()
  } else {
    await startScreenShare()
  }
}

// 屏幕画面自带系统声音，跟随扬声器开关；摄像头画面的声音由 remoteAudioRef 播放，这里静音
const assignScreenVideos = async () => {
  await nextTick()
  if (!showRemoteScreen.value) return
  const screen = remoteScreenStream.value
  const camera = callType === CallTypeEnum.VIDEO && hasRemoteVideo.value ? remoteStream.value : null
  const main = isScreenOnMain.value || !camera ? screen : camera
  const pip = main === screen ? camera : screen
  if (screenMainVideoRef.value) {
    screenMainVideoRef.value.srcObject = main
    screenMainVideoRef.value.muted = main !== screen || !isSpeakerOn.value
  }
  if (screenPipVideoRef.value) {
    screenPipVideoRef.value.srcObject = pip
    screenPipVideoRef.value.muted = pip !== screen || !isSpeakerOn.value
  }
}

// 检测本地视频是否启用
const hasLocalVideo = computed(() => {
  return isVideoEnabled.value && !!localStream.value
})

// 获取窗口最大化状态
const isWindowMaximized = computed(() => {
  return actionBarRef.value?.windowMaximized
})

const pipVideoSizeClass = computed(() => {
  if (!isMobileDevice) {
    return isWindowMaximized.value ? 'w-320px h-190px' : 'w-120px h-90px'
  }
  return 'w-140px h-160px'
})

// 是否显示准备中的头像
const shouldCenterPreparingAvatar = computed(() => {
  if (!isMobileDevice) {
    return false
  }

  if (!connectionStatus.value) {
    return true
  }

  return connectionStatus.value !== RTCCallStatus.END && connectionStatus.value !== RTCCallStatus.ERROR
})

// 视频流分配工具函数
const assignVideoStreams = async () => {
  await nextTick()

  if (!hasLocalVideo.value && !hasRemoteVideo.value) {
    // 双方都没有视频，清空所有视频元素
    clearVideoElements()
    return
  }

  if (hasLocalVideo.value && hasRemoteVideo.value) {
    // 双方都有视频，按布局分配
    assignDualVideoStreams()
  } else if (hasLocalVideo.value) {
    // 只有本地视频
    assignSingleVideoStream(localStream.value, true)
  } else if (hasRemoteVideo.value) {
    // 只有远程视频
    assignSingleVideoStream(remoteStream.value, false)
  }
}

// 清空视频元素
const clearVideoElements = () => {
  if (mainVideoRef.value) mainVideoRef.value.srcObject = null
  if (pipVideoRef.value) pipVideoRef.value.srcObject = null
}

// 分配双视频流
const assignDualVideoStreams = () => {
  if (isLocalVideoMain.value) {
    // 本地视频作为主视频
    setVideoElement(mainVideoRef.value, localStream.value, true)
    setVideoElement(pipVideoRef.value, remoteStream.value)
  } else {
    // 远程视频作为主视频
    setVideoElement(mainVideoRef.value, remoteStream.value)
    setVideoElement(pipVideoRef.value, localStream.value, true)
  }
}

// 分配单视频流
const assignSingleVideoStream = (stream: MediaStream | null, isMuted: boolean) => {
  setVideoElement(mainVideoRef.value, stream, isMuted)
  setVideoElement(pipVideoRef.value, null, isMuted)
}

// 设置视频元素
const setVideoElement = (
  videoElement: HTMLVideoElement | undefined,
  stream: MediaStream | null,
  isMuted: boolean = false
) => {
  if (!videoElement) return

  videoElement.srcObject = stream
  videoElement.muted = isMuted

  // 设置完成后统一更新音频状态
  if (stream) {
    nextTick(() => updateRemoteVideoAudio())
  }
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
  toggleMuteWebRtc()
}

// 更新所有远程视频元素的音频状态
const updateRemoteVideoAudio = () => {
  const shouldMute = !isSpeakerOn.value
  info(`updateRemoteVideoAudio, shouldMute: ${shouldMute}`)

  // 更新专用的音频元素
  if (remoteAudioRef.value && remoteStream.value) {
    remoteAudioRef.value.srcObject = remoteStream.value
    remoteAudioRef.value.muted = shouldMute
  }

  // 检查主视频是否是远程流
  if (mainVideoRef.value && mainVideoRef.value.srcObject === remoteStream.value) {
    mainVideoRef.value.muted = shouldMute
  }

  // 检查画中画视频是否是远程流
  if (pipVideoRef.value && pipVideoRef.value.srcObject === remoteStream.value) {
    pipVideoRef.value.muted = shouldMute
  }
}

const toggleSpeaker = () => {
  isSpeakerOn.value = !isSpeakerOn.value
  updateRemoteVideoAudio()
  void assignScreenVideos()
  console.log('切换扬声器状态:', isSpeakerOn.value, '远程视频静音:', !isSpeakerOn.value)

  if (connectionStatus.value === RTCCallStatus.CALLING && !isSpeakerOn.value) {
    pauseBell()
  } else if (connectionStatus.value === RTCCallStatus.CALLING && isSpeakerOn.value) {
    playBell()
  }
}

const toggleVideo = async () => {
  try {
    // 调用WebRTC层面的视频开关
    await toggleVideoWebRtc()

    // 同步UI状态
    isVideoOn.value = isVideoEnabled.value

    // 重新分配视频流
    await assignVideoStreams()
  } catch (error) {
    console.error('切换视频失败:', error)
  }
}

// 切换视频布局
const toggleVideoLayout = async () => {
  isLocalVideoMain.value = !isLocalVideoMain.value
  // 重新分配视频流
  await assignVideoStreams()
}

// 接听通话
const acceptCall = async () => {
  // 立即停止铃声
  stopBell()
  isCallAccepted.value = true
  // 调用接听响应函数
  sendRtcCall2VideoCallResponse(1)

  // 调整窗口大小为正常通话大小
  try {
    const currentWindow = WebviewWindow.getCurrent()
    const isVideo = callType === CallTypeEnum.VIDEO
    await currentWindow.setSize(createSize(isVideo ? 850 : 500, isVideo ? 580 : 650))
    await currentWindow.center()

    // 取消窗口置顶
    await currentWindow.setAlwaysOnTop(false)

    // 恢复标题栏按钮显示
    if (isMac()) {
      await invokeSilently('show_title_bar_buttons', { windowLabel: currentWindow.label })
    }

    // 确保窗口获得焦点
    try {
      await currentWindow.setFocus()
    } catch (error) {
      console.warn('Failed to set window focus after accepting call:', error)
    }
  } catch (error) {
    console.error('Failed to resize window after accepting call:', error)
  }
}

// 视频背景板：选择变了就应用；拿到摄像头后应用上次记住的选择
const videoBackgroundStore = useVideoBackgroundStore()
const applyBackground = async () => {
  if (callType !== CallTypeEnum.VIDEO || !localStream.value) return
  try {
    await applyVideoBackground(videoBackgroundStore.currentEffect, {
      onDegrade: () => window.$message.info(t('message.call_window.bg_degraded')),
      onOverload: () => {
        window.$message.warning(t('message.call_window.bg_overloaded'))
        videoBackgroundStore.select('none')
      }
    })
  } catch {
    window.$message.error(t('message.call_window.bg_failed'))
    videoBackgroundStore.select('none')
  }
}
watch(() => videoBackgroundStore.currentEffect, applyBackground)
watch(localStream, (stream, previous) => {
  if (stream && !previous && videoBackgroundStore.selected !== 'none') void applyBackground()
})

// 监听视频状态变化，自动更新视频显示
watch([hasLocalVideo, hasRemoteVideo, localStream, remoteStream], assignVideoStreams, { deep: true })

watch([showRemoteScreen, remoteScreenStream, remoteStream, hasRemoteVideo, isScreenOnMain], assignScreenVideos)

// 监听远程流变化，自动设置音频
watch(
  remoteStream,
  (newStream) => {
    if (remoteAudioRef.value && newStream) {
      remoteAudioRef.value.srcObject = newStream
      remoteAudioRef.value.muted = !isSpeakerOn.value
    }
  },
  { immediate: true }
)

// 同步初始视频状态
watch(
  isVideoEnabled,
  (newVal) => {
    isVideoOn.value = newVal
  },
  { immediate: true }
)

// 生命周期
onMounted(async () => {
  if (isMobileDevice) {
    if (isReceiver && !isCallAccepted.value && !shouldAutoAccept) {
      startBell()
    }

    if (shouldAutoAccept && isReceiver && !isCallAccepted.value) {
      await nextTick()
      await acceptCall()
    }
    return
  }

  const currentWindow = WebviewWindow.getCurrent()

  // 监听窗口关闭事件，确保关闭窗口时挂断通话
  const unlistenCloseRequested = await currentWindow.onCloseRequested(async (_event) => {
    try {
      // 如果是通话状态，先发送挂断消息
      if (connectionStatus.value === RTCCallStatus.CALLING || connectionStatus.value === RTCCallStatus.ACCEPT) {
        await sendRtcCall2VideoCallResponse(CallResponseStatus.DROPPED)
        unlistenCloseRequested()
      }
    } catch (error) {
      console.error('发送挂断消息失败:', error)
    }
  })

  if (isDesktop()) {
    if (shouldAutoAccept && isReceiver && !isCallAccepted.value) {
      // 网页版：用户已在主页的来电提示里点了接听，打开通话页后直接接通
      await acceptCall()
    } else if (isReceiver && !isCallAccepted.value) {
      // 接收方立即开始播放铃声
      startBell()

      // 设置来电通知窗口的正确大小和位置
      await currentWindow.setSize(createSize(360, 90))

      // 隐藏标题栏和设置窗口不可移动
      if (isMac()) {
        await invokeSilently('hide_title_bar_buttons', { windowLabel: currentWindow.label, hideCloseButton: true })
      }

      // 获取屏幕尺寸并定位
      const monitor = await primaryMonitor()
      if (monitor) {
        const margin = 20
        const taskbarHeight = 40

        let screenWidth: number
        let screenHeight: number
        let x: number
        let y: number

        if (isWindows()) {
          // Windows使用逻辑像素进行计算，窗口在右下角
          screenWidth = monitor.size.width / (monitor.scaleFactor || 1)
          screenHeight = monitor.size.height / (monitor.scaleFactor || 1)
          x = Math.max(0, screenWidth - 360 - margin)
          y = Math.max(0, screenHeight - 90 - margin - taskbarHeight)
          await currentWindow.setPosition(new LogicalPosition(x, y))
        } else {
          // Mac使用物理像素进行计算，窗口在右上角
          screenWidth = monitor.size.width
          screenHeight = monitor.size.height
          x = Math.max(0, screenWidth - 360 - margin)
          y = margin
          await currentWindow.setPosition(new PhysicalPosition(x, y))
        }
      } else {
        // 如果无法获取主显示器信息，使用屏幕右下角的估算位置
        await currentWindow.setPosition(new LogicalPosition(800, 600))
      }
      await currentWindow.setAlwaysOnTop(true)
    } else {
      // 正常通话窗口设置
      await currentWindow.center()
      await currentWindow.setAlwaysOnTop(false)

      // 确保标题栏按钮显示（非来电通知状态）
      if (isMac()) {
        await invokeSilently('show_title_bar_buttons', { windowLabel: currentWindow.label })
      }
    }

    // 确保窗口显示
    await currentWindow.show()
    await currentWindow.setFocus()
  }
})

defineExpose({
  hangUp
})
</script>

<style scoped>
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}
</style>
