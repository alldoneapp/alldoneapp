import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AccessibilityInfo } from 'react-native'
import VoiceCallConnecting from './VoiceCallConnecting'

jest.mock('../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => key.replace('%{assistantName}', values.assistantName || ''),
}))

let container, root, updateMotion
beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => {
    delete global.IS_REACT_ACT_ENVIRONMENT
})
beforeEach(() => {
    window.matchMedia = jest.fn(() => ({ matches: false }))
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, listener) => {
        updateMotion = listener
        return { remove: jest.fn() }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete window.matchMedia
    jest.restoreAllMocks()
})

test('announces the assistant and animates until reduced motion is enabled', async () => {
    await act(async () => root.render(<VoiceCallConnecting assistantName="Anna" />))
    const status = container.querySelector('[role="status"]')
    expect(status.textContent).toContain('Connecting with Anna…')
    expect(status.getAttribute('aria-live')).toBe('polite')
    const ring = container.querySelector('[data-testid="voice-call-connecting-ring"]')
    expect(getComputedStyle(ring).animationDuration).toBe('1.2s')
    act(() => updateMotion(true))
    expect(getComputedStyle(ring).animationDuration).toBe('')
    expect(status.textContent).toContain('Connecting with Anna…')
    act(() => updateMotion(false))
    expect(getComputedStyle(ring).animationDuration).toBe('1.2s')
})

test('honours reduced motion on the first render and removes its listener on unmount', () => {
    window.matchMedia.mockReturnValue({ matches: true })
    AccessibilityInfo.isReduceMotionEnabled.mockResolvedValue(true)
    const remove = jest.fn()
    AccessibilityInfo.addEventListener.mockReturnValue({ remove })
    act(() => root.render(<VoiceCallConnecting assistantName="Anna" />))
    const ring = container.querySelector('[data-testid="voice-call-connecting-ring"]')
    expect(getComputedStyle(ring).animationDuration).toBe('')
    act(() => root.render(null))
    expect(remove).toHaveBeenCalledTimes(1)
})
