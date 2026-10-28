import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileStyle, parse } from 'vue/compiler-sfc'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'
import { desktopThemeAccessibility } from './desktopTheme'

type Color = [number, number, number, number]

const readVariables = (css: string, selector: string): Record<string, string> => {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Missing CSS selector: ${selector}`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}

const parseColor = (value: string): Color => {
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value)
  if (hex) {
    const raw = hex[1].length <= 4 ? [...hex[1]].map((char) => char + char).join('') : hex[1]
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
      raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1
    ]
  }
  const rgba = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value)
  if (!rgba) throw new Error(`Unsupported color: ${value}`)
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])]
}

const composite = (foreground: Color, background: Color): Color => {
  const alpha = foreground[3]
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1
  ]
}

const luminance = (color: Color): number => {
  const values = color.slice(0, 3).map((component) => {
    const value = component / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]
}

const contrast = (foreground: Color, background: Color): number => {
  const a = luminance(composite(foreground, background))
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const compile = (...parts: string[]) =>
  sass.compile(resolve(process.cwd(), 'src', 'styles', 'scss', ...parts), { logger: sass.Logger.silent }).css

const globalCss = compile('global', 'variable.scss')
const loginCss = compile('global', 'login-bg.scss')
const layoutCss = {
  default: compile('theme', 'default.scss'),
  simple: compile('theme', 'simple.scss')
}

const themeVariables = (theme: 'light' | 'dark', layout: 'default' | 'simple') => ({
  ...readVariables(globalCss, ':root'),
  ...readVariables(globalCss, 'html[data-desktop=true]'),
  ...(theme === 'dark' ? readVariables(globalCss, 'html[data-theme=dark]') : {}),
  ...(theme === 'dark' ? readVariables(globalCss, 'html[data-theme=dark][data-desktop=true]') : {}),
  ...readVariables(layoutCss[layout], `:root .${layout}`),
  ...(layout === 'default' ? readVariables(layoutCss[layout], 'html[data-desktop=true] .default') : {}),
  ...(theme === 'dark' ? readVariables(layoutCss[layout], `html[data-theme=dark] .${layout}`) : {}),
  ...(theme === 'dark' ? readVariables(layoutCss[layout], `html[data-theme=dark][data-desktop=true] .${layout}`) : {})
})

describe('contrast calculation', () => {
  it('uses WCAG luminance and composites transparency', () => {
    expect(contrast(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 5)
    expect(contrast(parseColor('rgba(0, 0, 0, 0.5)'), parseColor('#ffffff'))).toBeCloseTo(3.98, 2)
  })

  it('overrides custom-colored disabled buttons on desktop', () => {
    const disabled = readVariables(globalCss, 'html[data-desktop=true] .n-button.n-button--disabled')
    expect(disabled['n-color-disabled']).toBe('var(--control-disabled-bg) !important')
    expect(disabled['n-text-color-disabled']).toBe('var(--control-disabled-text) !important')
    expect(disabled['n-opacity-disabled']).toBe('1 !important')
  })

  it('overrides translucent secondary button colors on desktop', () => {
    const secondary = readVariables(
      globalCss,
      'html[data-desktop=true] .n-button.n-button--secondary:not(.n-button--disabled)'
    )
    expect(secondary['n-color']).toBe('var(--secondary-control-bg) !important')
    expect(secondary['n-text-color']).toBe('var(--secondary-foreground) !important')
  })

  it('scopes file status contrast overrides to desktop file cards after Vue compilation', () => {
    const filename = resolve(process.cwd(), 'src', 'components', 'rightBox', 'renderMessage', 'File.vue')
    const style = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.styles[0]
    const result = compileStyle({
      filename,
      source: style.content,
      id: 'data-v-theme-test',
      scoped: true,
      preprocessLang: 'scss'
    })
    expect(result.errors).toEqual([])
    expect(result.code).toContain("html[data-desktop='true'] .file-container .download-status {")
    expect(result.code).toContain("html[data-desktop='true'] .file-container .download-status.downloaded {")
    expect(result.code).toContain("html[data-desktop='true'] .file-container.uploading")
    expect(result.code).not.toContain("html[data-desktop='true'] {\n  background:")
  })

  it('keeps login text and the light and dark header marks readable', () => {
    expect(loginCss).toContain('html[data-theme=dark][data-desktop=true] .login-box')
    for (const [foreground, background] of [
      ['#596579', '#e9edf5'],
      ['#c1ccda', '#151d28'],
      ['#ffffff', '#034fbc'],
      ['#ffffff', '#0a1f54'],
      ['#ffffff', '#2455a4'],
      ['#ffffff', '#202d3b']
    ]) {
      expect(contrast(parseColor(foreground), parseColor(background))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe.each(['light', 'dark'] as const)('desktop %s theme contrast', (theme) => {
  for (const layout of ['default', 'simple'] as const) {
    it(`meets text and control thresholds in the ${layout} layout`, () => {
      const vars = themeVariables(theme, layout)
      const color = (name: string) => {
        if (!vars[name]) throw new Error(`Missing theme variable: ${name}`)
        return parseColor(vars[name])
      }
      const textPairs: Array<[string, string, string]> = [
        ['main text', 'text-color', 'right-theme-bg-color'],
        ['panel text', 'text-color', 'center-bg-color'],
        ['incoming message', 'text-color', 'bg-bubble'],
        ['dialog heading', 'text-color', 'bg-edit'],
        ['settings text', 'text-color', 'bg-setting-item'],
        ['secondary text', 'chat-text-color', 'center-bg-color'],
        ['secondary text on bubble', 'chat-text-color', 'bg-bubble'],
        ['muted text', 'text-muted-color', 'right-theme-bg-color'],
        ['muted text on popover', 'text-muted-color', 'bg-popover'],
        ['muted settings text', 'text-muted-color', 'bg-setting-item'],
        ['file details', 'text-muted-color', 'file-bg-color'],
        ['file status', 'text-muted-color', 'secondary-control-bg'],
        ['file metadata', 'text-muted-color', 'right-bg-color'],
        ['feed timestamp', 'text-muted-color', 'center-bg-color'],
        ['feed liked state', 'danger-text', 'center-bg-color'],
        ['feed links', 'link-color', 'center-bg-color'],
        ['selected session', 'msg-active-text-color', 'msg-active-color'],
        ['selected warning', 'selected-danger-text', 'msg-active-color'],
        ['danger message', 'danger-text', 'danger-bg'],
        ['warning message', 'warning-text', 'warning-bg'],
        ['message link', 'link-color', 'bg-bubble'],
        ['panel link', 'link-color', 'bg-popover'],
        ['search highlight', 'search-hit-color', 'search-hit-bg'],
        ['sidebar label', 'left-text-color', 'left-bg-color']
      ]
      for (const [label, foreground, background] of textPairs) {
        const ratio = contrast(color(foreground), color(background))
        expect(ratio, `${theme}/${layout} ${label}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }

      const ownBubble = contrast(parseColor('#ffffff'), color('bg-active-msg'))
      expect(ownBubble, `${theme}/${layout} outgoing message`).toBeGreaterThanOrEqual(4.5)
      const sidebarIcon = contrast(color('left-icon-color'), color('left-bg-color'))
      expect(sidebarIcon, `${theme}/${layout} sidebar icon`).toBeGreaterThanOrEqual(3)
      const selectedSidebarBg = composite(color('left-active-bg-color'), color('left-bg-color'))
      const selectedSidebarIcon = contrast(color('left-active-icon-color'), selectedSidebarBg)
      expect(selectedSidebarIcon, `${theme}/${layout} selected sidebar icon`).toBeGreaterThanOrEqual(3)
      const focus = contrast(color('link-color'), color('bg-edit'))
      expect(focus, `${theme}/${layout} focus indicator`).toBeGreaterThanOrEqual(3)

      const controls = desktopThemeAccessibility[theme]
      expect(vars['control-disabled-bg']).toBe(controls.disabledBackground)
      expect(vars['control-disabled-text']).toBe(controls.mutedText)
      expect(vars['control-disabled-border']).toBe(controls.inputBorder)
      const placeholder = contrast(parseColor(controls.mutedText), parseColor(controls.inputBackground))
      expect(placeholder, `${theme}/${layout} input placeholder`).toBeGreaterThanOrEqual(4.5)
      const disabled = contrast(parseColor(controls.mutedText), parseColor(controls.disabledBackground))
      expect(disabled, `${theme}/${layout} disabled text`).toBeGreaterThanOrEqual(4.5)
      const inputBorder = contrast(parseColor(controls.inputBorder), parseColor(controls.inputBackground))
      expect(inputBorder, `${theme}/${layout} input border`).toBeGreaterThanOrEqual(3)
      for (const kind of ['primary', 'info', 'success', 'warning', 'error'] as const) {
        expect(vars[`secondary-${kind}-text`]).toBe(controls[kind])
        for (const state of ['bg', 'hover', 'pressed']) {
          const ratio = contrast(color(`secondary-${kind}-text`), color(`secondary-control-${state}`))
          expect(ratio, `${theme}/${layout} ${kind} secondary ${state}`).toBeGreaterThanOrEqual(4.5)
        }
        const tertiaryOverlay =
          theme === 'light' ? parseColor('rgba(46, 51, 56, 0.12)') : parseColor('rgba(255, 255, 255, 0.12)')
        for (const kind of ['primary', 'info', 'success', 'warning', 'error'] as const) {
          for (const surface of ['right-theme-bg-color', 'bg-edit', 'bg-popover']) {
            const background = composite(tertiaryOverlay, color(surface))
            const ratio = contrast(parseColor(controls[kind]), background)
            expect(ratio, `${theme}/${layout} ${kind} tertiary on ${surface}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
      for (const [state, background] of [
        ['normal', controls.primary],
        ['hover', controls.primaryHover],
        ['pressed', controls.primaryPressed]
      ]) {
        const primaryText = contrast(parseColor(controls.primaryText), parseColor(background))
        expect(primaryText, `${theme}/${layout} primary ${state}`).toBeGreaterThanOrEqual(4.5)
      }
      if (theme === 'light') {
        for (const background of [
          desktopThemeAccessibility.light.success,
          desktopThemeAccessibility.light.successHover,
          desktopThemeAccessibility.light.successPressed
        ]) {
          expect(contrast(parseColor('#ffffff'), parseColor(background))).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }
})
