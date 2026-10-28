import {
  type FormInst,
  NAvatar,
  NButton,
  NFlex,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NProgress,
  NScrollbar,
  NSkeleton,
  NTimeline,
  NTimelineItem
} from 'naive-ui'
import { emit } from '@tauri-apps/api/event'
import { EventEnum } from '@/enums'
import './style.scss'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { useSettingStore } from '@/stores/setting.ts'
import { useUserStore } from '@/stores/user.ts'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { isMac } from '@/utils/PlatformConstants'
import {
  currentReleaseDate,
  currentReleaseNotes,
  formatReleaseDate,
  splitReleaseNotes,
  updaterDateToIso
} from '@/utils/ReleaseInfo'
import { useI18n } from 'vue-i18n'

const formRef = ref<FormInst | null>()
const formValue = ref({
  lockPassword: ''
})
export const modalShow = ref(false)
export const lock = ref({
  loading: false,
  rules: {
    lockPassword: {
      required: true,
      message: '',
      trigger: ['input']
    }
  },
  async handleLock() {
    const settingStore = useSettingStore()
    const { lockScreen } = storeToRefs(settingStore)
    formRef.value?.validate((errors) => {
      if (errors) return
      lock.value.loading = true
      lockScreen.value.password = formValue.value.lockPassword
      lockScreen.value.enable = true
      setTimeout(async () => {
        /** 发送锁屏事件，当打开的窗口接受到后会自动锁屏 */
        await emit(EventEnum.LOCK_SCREEN)
        lock.value.loading = false
        modalShow.value = false
        formValue.value.lockPassword = ''
      }, 1000)
    })
    formRef.value?.restoreValidation()
  }
})

/*============================================ model =====================================================*/
/**  锁屏弹窗 */
export const LockScreen = defineComponent(() => {
  const userStore = useUserStore()
  const { t } = useI18n()
  lock.value.rules.lockPassword.message = t('message.lock_screen.validation_required')
  return () => (
    <NModal v-model:show={modalShow.value} maskClosable={false} class="w-350px border-rd-8px">
      <div class="bg-[--bg-popover] w-360px h-full p-6px box-border flex flex-col">
        {isMac() ? (
          <div
            onClick={() => (modalShow.value = false)}
            role="button"
            title={t('tooltip.close')}
            aria-label={t('tooltip.close')}
            class="mac-close relative size-13px shadow-inner bg-#ed6a5eff rounded-50% select-none">
            <svg class="hidden size-7px color-#000 select-none absolute top-3px left-3px">
              <use href="#close"></use>
            </svg>
          </div>
        ) : (
          <svg onClick={() => (modalShow.value = false)} class="w-12px h-12px ml-a cursor-pointer select-none">
            <title>{t('tooltip.close')}</title>
            <use href="#close"></use>
          </svg>
        )}
        <div class="flex flex-col gap-10px p-10px select-none">
          <NFlex vertical justify="center" align="center" size={20}>
            <span class="text-(14px center)">{t('message.lock_screen.title')}</span>

            <NAvatar
              bordered
              round
              size={80}
              src={AvatarUtils.getAvatarUrl(userStore.userInfo!.avatar, userStore.userInfo!.uid)}
            />

            <p class="text-(14px center [--text-color]) truncate w-200px">{userStore.userInfo!.name}</p>
          </NFlex>
          <NForm ref={formRef} model={formValue.value} rules={lock.value.rules}>
            <NFormItem
              label-placement="left"
              label={t('message.lock_screen.password_label')}
              path={'lockPassword'}
              class="w-full">
              <NInput
                show-password-on="click"
                v-model:value={formValue.value.lockPassword}
                class="border-(1px solid #ccc)"
                size="small"
                type="password"
                placeholder={t('message.lock_screen.password_placeholder')}
              />
            </NFormItem>
          </NForm>

          <NButton loading={lock.value.loading} onClick={lock.value.handleLock} class="w-full" color="#034fbc" textColor="#ffffff">
            {t('message.lock_screen.confirm_button')}
          </NButton>
        </div>
      </div>
    </NModal>
  )
})

/**
 * 检查更新弹窗
 */
export const CheckUpdate = defineComponent(() => {
  const { t } = useI18n()
  /** 项目提交日志记录 */
  const commitLog = ref<{ message: string; icon: string }[]>([])
  const newCommitLog = ref<{ message: string; icon: string }[]>([])
  type ButtonState = 'check_now' | 'update_now' | 'downloading' | 'update_success'
  const buttonState = ref<ButtonState>('check_now')
  const currentVersion = ref('')
  const newVersion = ref('')
  const loading = ref(false)
  const checkLoading = ref(false)
  const updating = ref(false)
  /** 版本更新日期 */
  const versionTime = ref('')
  const newVersionTime = ref('')
  const percentage = ref(0)
  const total = ref(0)
  const downloaded = ref(0)

  const commitTypeMap: { [key: string]: string } = {
    feat: 'comet',
    fix: 'bug',
    docs: 'memo',
    style: 'lipstick',
    refactor: 'recycling-symbol',
    perf: 'rocket',
    test: 'test-tube',
    build: 'package',
    ci: 'gear',
    revert: 'right-arrow-curving-left',
    chore: 'hammer-and-wrench'
  }

  const mapCommitType = (commitMessage: string) => {
    for (const type in commitTypeMap) {
      if (new RegExp(`^${type}`, 'i').test(commitMessage)) {
        return commitTypeMap[type]
      }
    }
  }

  /** 发布说明转成时间线条目 */
  const notesToLogs = (notes?: string) =>
    splitReleaseNotes(notes).map((message) => ({ message, icon: mapCommitType(message) || 'alien-monster' }))

  const doUpdate = async () => {
    buttonState.value = 'downloading'
    updating.value = true
    checkLoading.value = true
    await check()
      .then(async (e) => {
        if (!e?.available) {
          return
        }

        await e.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              total.value = event.data.contentLength ? event.data.contentLength : 0
              break
            case 'Progress':
              downloaded.value += event.data.chunkLength
              percentage.value = parseFloat(((downloaded.value / total.value) * 100 + '').substring(0, 4))
              break
            case 'Finished':
              window.$message.success(t('message.check_update.download_success_toast'))
              buttonState.value = 'update_success'
              updating.value = false
              break
          }
        })
        try {
          await relaunch()
        } catch (e) {
          console.log(e)
          window.$message.error(t('message.check_update.restart_failed'))
        }
      })
      .catch(() => {
        window.$message.error(t('message.check_update.update_error'))
      })
      .finally(() => {
        checkLoading.value = false
        updating.value = false
      })
  }

  const checkUpdate = async () => {
    checkLoading.value = true
    buttonState.value = 'check_now'
    await check()
      .then((e) => {
        if (!e?.available) {
          checkLoading.value = false
          return
        }
        newVersion.value = e.version
        newVersionTime.value = updaterDateToIso(e.date)
        newCommitLog.value = notesToLogs(e.body)
        buttonState.value = 'update_now'
        checkLoading.value = false
      })
      .catch(() => {
        checkLoading.value = false
        window.$message.error(t('message.check_update.update_error'))
      })
  }

  const init = async () => {
    loading.value = true
    currentVersion.value = await getVersion()
    versionTime.value = currentReleaseDate
    commitLog.value = notesToLogs(currentReleaseNotes)
    loading.value = false
  }

  onMounted(async () => {
    await init()
    await checkUpdate()
  })
  return () => (
    <NModal v-model:show={modalShow.value} maskClosable={false} class="w-350px border-rd-8px">
      <div class="bg-[--bg-popover] w-500px h-full p-6px box-border flex flex-col">
        {isMac() ? (
          <div
            onClick={() => (modalShow.value = false)}
            role="button"
            title={t('tooltip.close')}
            aria-label={t('tooltip.close')}
            class="mac-close relative size-13px shadow-inner bg-#ed6a5eff rounded-50% select-none">
            <svg class="hidden size-7px color-#000  select-none absolute top-3px left-3px">
              <use href="#close"></use>
            </svg>
          </div>
        ) : (
          <svg onClick={() => (modalShow.value = false)} class="w-12px h-12px ml-a cursor-pointer select-none">
            <title>{t('tooltip.close')}</title>
            <use href="#close"></use>
          </svg>
        )}
        {loading.value ? (
          <NFlex vertical justify={'center'} size={10} class="mt-6px">
            <NSkeleton text repeat={1} class="rounded-8px h-30px w-120px" />
            <NSkeleton text repeat={1} class="rounded-8px h-300px" />
            <NSkeleton text repeat={1} class="rounded-8px w-80px h-30px m-[0_0_0_auto]" />
          </NFlex>
        ) : (
          <NFlex size={10} vertical justify={'center'} class="p-14px box-border select-none">
            <NFlex justify={'space-between'} align={'center'} size={0}>
              <NFlex align={'center'} size={10}>
                <NFlex align={'center'} size={10}>
                  <p>{t('message.check_update.current_version')}:</p>
                  <p class="text-(20px #909090) font-500">{currentVersion.value}</p>
                </NFlex>

                {newVersion.value ? (
                  <NFlex align={'center'} size={10} class="relative">
                    <svg class="w-24px h-24px select-none color-#ccc">
                      <use href={'#RightArrow'}></use>
                    </svg>

                    <p class="relative text-(20px #034fbc) font-500">{newVersion.value}</p>

                    <span class="absolute top--10px right--44px p-[4px_8px] bg-#f6dfe3ff rounded-6px text-(12px #ce304f)">
                      {t('message.check_update.new_tag')}
                    </span>
                  </NFlex>
                ) : null}
              </NFlex>
              <NFlex align={'center'} size={10}>
                {formatReleaseDate(newVersionTime.value) ? (
                  <>
                    <p class="text-(12px #909090)">{t('message.check_update.new_release_date')}</p>
                    <p class="text-(12px #034fbc)">{formatReleaseDate(newVersionTime.value)}</p>
                  </>
                ) : formatReleaseDate(versionTime.value) ? (
                  <>
                    <p class="text-(12px #909090)">{t('message.check_update.release_date')}</p>
                    <p class="text-(12px #034fbc)">{formatReleaseDate(versionTime.value)}</p>
                  </>
                ) : null}
              </NFlex>
            </NFlex>
            <p class="text-(14px #909090)">{t('message.check_update.log_title')}</p>
            <NScrollbar class="max-h-460px p-[0_10px] box-border">
              {newCommitLog.value.length > 0 ? (
                <>
                  <div class="p-[4px_8px] mt-4px w-fit bg-#f6dfe3ff rounded-6px text-(12px #ce304f)">
                    {newVersion.value}
                  </div>

                  <NTimeline class="p-16px box-border">
                    {newCommitLog.value.map((log, index) => (
                      <NTimelineItem key={index} content={log.message}>
                        {{
                          icon: () => (
                            <NIcon size={32}>
                              <img class="size-32px" src={`/emoji/${log.icon}.webp`} alt="" />
                            </NIcon>
                          )
                        }}
                      </NTimelineItem>
                    ))}
                  </NTimeline>

                  <NFlex>
                    <NFlex vertical size={20}>
                      <svg class="m-[4px_40px] w-24px h-24px select-none rotate-270 color-#ccc">
                        <use href={'#RightArrow'}></use>
                      </svg>

                      <span class="p-[4px_8px] w-fit bg-#f1f1f1 rounded-6px text-(12px #999)">
                        {currentVersion.value}
                      </span>
                    </NFlex>
                  </NFlex>
                </>
              ) : null}

              {commitLog.value.length === 0 ? (
                <p class="p-[10px_16px] text-(12px #909090)">{t('message.auto_update.no_notes')}</p>
              ) : null}

              <NTimeline class="p-16px box-border">
                {commitLog.value.map((log, index) => (
                  <NTimelineItem key={index} content={log.message}>
                    {{
                      icon: () => (
                        <NIcon size={32}>
                          {/*<svg>*/}
                          {/*  <use href={`#${log.icon}`}></use>*/}
                          {/*</svg>*/}
                          <img class="size-32px" src={`/emoji/${log.icon}.webp`} alt="" />
                        </NIcon>
                      )
                    }}
                  </NTimelineItem>
                ))}
              </NTimeline>
            </NScrollbar>
            <NFlex justify={'end'}>
              <NButton
                loading={checkLoading.value}
                onClick={buttonState.value === 'update_now' ? doUpdate : checkUpdate}
                secondary
                type={buttonState.value === 'update_now' ? 'primary' : 'tertiary'}>
                {t(`message.check_update.${buttonState.value}`)}
                {buttonState.value === 'downloading' &&
                  total.value > 0 &&
                  `${parseFloat((total.value / 1024 / 1024).toString()).toFixed(2)}M`}
              </NButton>
              {updating.value && (
                <NProgress
                  type="line"
                  color="#034fbc"
                  indicator-placement="inside"
                  percentage={percentage.value}
                  processing
                />
              )}
            </NFlex>
          </NFlex>
        )}
      </div>
    </NModal>
  )
})
