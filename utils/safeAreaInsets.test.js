/** @jest-environment jsdom */

import { getSafeAreaBottomInset, getSafeAreaInsets } from './safeAreaInsets'

describe('safeAreaInsets', () => {
    afterEach(() => jest.restoreAllMocks())

    it('resolves all four CSS env safe-area values', () => {
        const nativeGetComputedStyle = window.getComputedStyle.bind(window)
        jest.spyOn(window, 'getComputedStyle').mockImplementation(element => {
            if (element.hasAttribute('data-safe-area-inset-probe')) {
                return { paddingTop: '47px', paddingRight: '7px', paddingBottom: '34px', paddingLeft: '11px' }
            }
            return nativeGetComputedStyle(element)
        })

        expect(getSafeAreaInsets()).toEqual({ top: 47, right: 7, bottom: 34, left: 11 })
        expect(getSafeAreaBottomInset()).toBe(34)
        expect(document.querySelector('[data-safe-area-inset-probe]')).toBeNull()
    })

    it('falls back to zero for unsupported or non-pixel values', () => {
        jest.spyOn(window, 'getComputedStyle').mockReturnValue({
            paddingTop: '',
            paddingRight: 'auto',
            paddingBottom: '0px',
            paddingLeft: undefined,
        })

        expect(getSafeAreaInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    })
})
