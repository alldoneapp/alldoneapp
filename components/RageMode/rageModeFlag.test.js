import { isRageModeEnabled, RAGE_MODE_STORAGE_KEY } from './rageModeFlag'

const visit = search => window.history.replaceState({}, '', `/${search}`)

describe('rage mode switch', () => {
    beforeEach(() => {
        window.localStorage.clear()
        visit('')
    })

    it('is on for everyone by default', () => {
        expect(isRageModeEnabled()).toBe(true)
    })

    it('is switched off on this browser by the query parameter, and remembered', () => {
        visit('?rageMode=off')
        expect(isRageModeEnabled()).toBe(false)
        expect(window.localStorage.getItem(RAGE_MODE_STORAGE_KEY)).toBe('off')
        visit('')
        expect(isRageModeEnabled()).toBe(false)
    })

    it('is switched back on by the query parameter', () => {
        window.localStorage.setItem(RAGE_MODE_STORAGE_KEY, 'off')
        visit('?rageMode=on')
        expect(isRageModeEnabled()).toBe(true)
        visit('')
        expect(isRageModeEnabled()).toBe(true)
    })

    it('stays on when storage is unavailable', () => {
        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        expect(isRageModeEnabled()).toBe(true)
        spy.mockRestore()
    })
})
