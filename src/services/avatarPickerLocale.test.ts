import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import zhComponents from '~/locales/zh-CN/components.json'
import enComponents from '~/locales/en/components.json'
import koComponents from '~/locales/ko/components.json'

describe.each([
  ['zh-CN', zhComponents],
  ['en', enComponents],
  ['ko', koComponents]
])('avatar picker translations in %s', (locale, components) => {
  it('resolves every picker label and interpolates the avatar number', () => {
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: { components } } })
    for (const key of ['title', 'upload', 'saving', 'save_success', 'save_failed']) {
      const path = `components.avatarPicker.${key}`
      expect(i18n.global.te(path)).toBe(true)
      expect(i18n.global.t(path)).not.toBe(path)
    }
    const option = i18n.global.t('components.avatarPicker.option', { number: '022' })
    expect(option).toContain('022')
    expect(i18n.global.te('components.avatarCropper.uploading')).toBe(true)
  })
})
