import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileStyle, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

const filename = resolve(process.cwd(), 'src', 'views', 'loginWindow', 'Login.vue')
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const template = new DOMParser().parseFromString(descriptor.template!.content, 'text/html')
const style = compileStyle({
  filename,
  source: descriptor.styles[0].content.replaceAll('@/styles/scss/', ''),
  id: 'data-v-login-test',
  scoped: true,
  preprocessLang: 'scss',
  preprocessOptions: {
    loadPaths: [resolve(process.cwd(), 'src', 'styles', 'scss')]
  }
})

describe('desktop login presentation', () => {
  it('keeps the original reversed logo in one solid header in both login modes', () => {
    const header = template.querySelector('.login-header')!
    expect(header.hasAttribute('v-if')).toBe(false)
    expect(header.querySelector('brandlogo')?.hasAttribute('on-dark')).toBe(true)
    expect(template.querySelectorAll('brandlogo')).toHaveLength(1)
    expect(header.querySelector('actionbar')).not.toBeNull()
    expect(style.errors).toEqual([])
    expect(style.code).toMatch(/\.login-header[^{]*\{[^}]*background: #034fbc;/)
    expect(style.code).not.toContain('background-image')
    expect(style.code).not.toContain('linear-gradient')
  })

  it('keeps secondary actions keyboard accessible and centered without QR login', () => {
    const actions = [
      ...template.querySelectorAll('.login-footer-action'),
      ...Array.from(template.querySelectorAll('template')).flatMap((slot) =>
        Array.from(slot.content.querySelectorAll('.login-footer-action'))
      )
    ]
    expect(actions.length).toBeGreaterThanOrEqual(4)
    for (const action of actions) {
      expect(action.tagName).toBe('BUTTON')
      expect(action.getAttribute('type')).toBe('button')
    }
    expect(style.code).toMatch(/\.login-footer[^{]*\{[^}]*justify-content: center;/)
    expect(style.code).toContain(':focus-visible')
  })

  it('allows the MFA form to scroll and provides dark surfaces without recoloring the logo', () => {
    expect(template.querySelector('n-input[v-if="mfaRequired"]')).not.toBeNull()
    expect(style.code).toMatch(/\.login-box[^{]*\{[^}]*overflow: auto;/)
    expect(style.code).toMatch(/html\[data-theme=dark\] .login-box[^{]*\{[^}]*background: #151d28;/)
    expect(style.code).not.toMatch(/\.login-logo[^{]*\{[^}]*(filter|opacity|transform):/)
  })
})
