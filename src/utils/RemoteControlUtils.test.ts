import { describe, expect, it } from 'vitest'
import {
  containedContentRect,
  mouseButtonName,
  remoteKeyName,
  sameAspect,
  toRatioPoint,
  wheelSteps
} from './RemoteControlUtils'

const key = (k: string, code: string, isComposing = false) => remoteKeyName({ key: k, code, isComposing })

describe('containedContentRect', () => {
  it('扣掉左右黑边', () => {
    // 1600x900 的元素里放 4:3 画面，左右各 200 黑边
    expect(containedContentRect({ left: 0, top: 0, width: 1600, height: 900 }, 1200, 900)).toEqual({
      left: 200,
      top: 0,
      width: 1200,
      height: 900
    })
  })

  it('扣掉上下黑边', () => {
    expect(containedContentRect({ left: 10, top: 20, width: 800, height: 800 }, 1920, 1080)).toEqual({
      left: 10,
      top: 20 + (800 - 450) / 2,
      width: 800,
      height: 450
    })
  })

  it('画面尺寸还没有时返回 null', () => {
    expect(containedContentRect({ left: 0, top: 0, width: 800, height: 600 }, 0, 0)).toBeNull()
  })
})

describe('toRatioPoint', () => {
  const content = { left: 200, top: 0, width: 1200, height: 900 }
  it('换算成比例', () => {
    expect(toRatioPoint(content, 200, 0)).toEqual({ x: 0, y: 0 })
    expect(toRatioPoint(content, 800, 450)).toEqual({ x: 0.5, y: 0.5 })
    expect(toRatioPoint(content, 1400, 900)).toEqual({ x: 1, y: 1 })
  })
  it('黑边上不算', () => {
    expect(toRatioPoint(content, 100, 450)).toBeNull()
    expect(toRatioPoint(content, 1500, 450)).toBeNull()
  })
})

describe('remoteKeyName', () => {
  it('字母和数字按物理键位、取小写', () => {
    expect(key('A', 'KeyA')).toBe('a')
    expect(key('c', 'KeyC')).toBe('c')
    expect(key('!', 'Digit1')).toBe('1')
    expect(key('3', 'Numpad3')).toBe('3')
  })
  it('功能键和修饰键', () => {
    expect(key('Enter', 'Enter')).toBe('Enter')
    expect(key('Enter', 'NumpadEnter')).toBe('Enter')
    expect(key('Control', 'ControlLeft')).toBe('Control')
    expect(key('Meta', 'MetaLeft')).toBe('Meta')
    expect(key('F5', 'F5')).toBe('F5')
    expect(key(' ', 'Space')).toBe('Space')
    expect(key('ArrowLeft', 'ArrowLeft')).toBe('ArrowLeft')
  })
  it('符号键取不带 Shift 的字符', () => {
    expect(key('_', 'Minus')).toBe('-')
    expect(key('?', 'Slash')).toBe('/')
  })
  it('输入法组字中的按键不发', () => {
    expect(key('Process', 'KeyA')).toBeNull()
    expect(key('a', 'KeyA', true)).toBeNull()
    expect(key('Unidentified', '')).toBeNull()
  })
  it('其他布局的单个字符照发', () => {
    expect(key('ü', 'IntlBackslash')).toBe('ü')
    expect(key('AudioVolumeUp', 'AudioVolumeUp')).toBeNull()
  })
})

describe('wheelSteps', () => {
  it('一格 100 像素', () => {
    expect(wheelSteps(100, 0, 0)).toEqual({ steps: 1, carry: 0 })
    expect(wheelSteps(-300, 0, 0)).toEqual({ steps: -3, carry: 0 })
  })
  it('触摸板小幅滚动累积', () => {
    const first = wheelSteps(40, 0, 0)
    expect(first.steps).toBe(0)
    const second = wheelSteps(70, 0, first.carry)
    expect(second.steps).toBe(1)
    expect(second.carry).toBeCloseTo(10)
  })
  it('按行滚动', () => {
    expect(wheelSteps(3, 1, 0).steps).toBe(1)
  })
  it('一次最多 20 格', () => {
    expect(wheelSteps(100000, 0, 0).steps).toBe(20)
  })
})

describe('其他', () => {
  it('鼠标键', () => {
    expect(mouseButtonName(0)).toBe('left')
    expect(mouseButtonName(1)).toBe('middle')
    expect(mouseButtonName(2)).toBe('right')
    expect(mouseButtonName(3)).toBeNull()
  })
  it('宽高比判断主屏', () => {
    expect(sameAspect({ width: 1920, height: 1080 }, { width: 2560, height: 1440 })).toBe(true)
    expect(sameAspect({ width: 1360, height: 766 }, { width: 1920, height: 1080 })).toBe(true)
    expect(sameAspect({ width: 1920, height: 1200 }, { width: 1920, height: 1080 })).toBe(false)
    expect(sameAspect({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBe(true)
  })
})
