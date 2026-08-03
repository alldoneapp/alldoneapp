import { Platform } from 'react-native'

import { shouldAutoFocusTaskInput } from './taskInputFocus'

describe('shouldAutoFocusTaskInput', () => {
    const originalOS = Platform.OS

    afterEach(() => {
        Platform.OS = originalOS
    })

    test('does not auto-focus inline task inputs in a mobile-width web layout', () => {
        Platform.OS = 'web'

        expect(shouldAutoFocusTaskInput(true, true)).toBe(false)
    })

    test('does not auto-focus inline task inputs in a native mobile app', () => {
        Platform.OS = 'ios'

        expect(shouldAutoFocusTaskInput(true, false)).toBe(false)
    })

    test('keeps auto-focus for desktop inline tasks and existing-task editors', () => {
        Platform.OS = 'web'

        expect(shouldAutoFocusTaskInput(true, false)).toBe(true)
        expect(shouldAutoFocusTaskInput(false, true)).toBe(true)
    })
})
