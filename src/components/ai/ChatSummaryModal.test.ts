import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const summarize = vi.hoisted(() => vi.fn())
vi.mock('@/utils/ImRequestUtils', () => ({ summarizeChat: summarize }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ unreadSnapshot: { room: 3 } }) }))
vi.mock('@/utils/ComputedTime.ts', () => ({ formatTimestamp: () => '' }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import ChatSummaryModal from './ChatSummaryModal.vue'

const container = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.default?.())
})
const button = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h('button', attrs, slots.default?.())
})
const radioGroup = defineComponent({
  emits: ['update:value'],
  setup:
    (_, { slots, emit }) =>
    () =>
      h('div', [h('button', { onClick: () => emit('update:value', '50') }, 'select 50'), slots.default?.()])
})

describe('chat summary consent', () => {
  it('only invokes AI after confirmation, including when the range changes', async () => {
    summarize.mockReset()
    summarize.mockResolvedValue({ summary: 'summary', messageCount: 3, parts: 1, dropped: 0 })
    const wrapper = mount(ChatSummaryModal, {
      props: { roomId: 'room', roomName: 'Group', show: false },
      global: {
        stubs: { Modal: container, Flex: container, Button: button, RadioGroup: radioGroup, RadioButton: container }
      }
    })
    await wrapper.setProps({ show: true })
    expect(summarize).not.toHaveBeenCalled()
    expect(wrapper.html()).toContain('确认生成摘要')
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('确认生成摘要'))!
      .trigger('click')
    await flushPromises()
    expect(summarize).toHaveBeenCalledExactlyOnceWith({ roomId: 'room', count: 3, confirmed: true })
    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'select 50')!
      .trigger('click')
    expect(summarize).toHaveBeenCalledTimes(1)
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('确认生成摘要'))!
      .trigger('click')
    await flushPromises()
    expect(summarize).toHaveBeenLastCalledWith({ roomId: 'room', count: 50, confirmed: true })
    wrapper.unmount()
  })
})
