/**
 * @jest-environment jsdom
 *
 * Back-button close for bottom sheets (MODAL_IMPROVEMENT_PLAN.md Phase 5):
 * each open sheet owns one same-URL history entry; a popstate consumes the
 * topmost layer (LIFO) instead of navigating, and a sheet dismissed any other
 * way unwinds its entry without spending the user's next real back press.
 */
import {
    consumePopstateForSheetLayers,
    pushSheetHistoryLayer,
    releaseSheetHistoryLayer,
    resetSheetHistoryLayers,
    withSheetHistoryLayers,
} from './sheetHistoryLayers'

describe('sheetHistoryLayers', () => {
    beforeEach(() => {
        resetSheetHistoryLayers()
    })

    it('pushes a sentinel history entry per layer', () => {
        const before = window.history.length
        pushSheetHistoryLayer(() => {})
        expect(window.history.length).toBe(before + 1)
        expect(window.history.state.__alldoneSheetLayer).toMatch(/^sheet-/)
    })

    it('a popstate closes the topmost layer and is consumed', () => {
        const closeOuter = jest.fn()
        const closeInner = jest.fn()
        pushSheetHistoryLayer(closeOuter)
        pushSheetHistoryLayer(closeInner)

        expect(consumePopstateForSheetLayers()).toBe(true)
        expect(closeInner).toHaveBeenCalledTimes(1)
        expect(closeOuter).not.toHaveBeenCalled()

        expect(consumePopstateForSheetLayers()).toBe(true)
        expect(closeOuter).toHaveBeenCalledTimes(1)

        // Nothing left: the pop belongs to the app again.
        expect(consumePopstateForSheetLayers()).toBe(false)
    })

    it('releasing a back-consumed layer does not unwind history again', () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {})
        const close = jest.fn()
        const id = pushSheetHistoryLayer(close)

        consumePopstateForSheetLayers() // the user pressed back
        releaseSheetHistoryLayer(id) // the sheet's cleanup runs after close

        expect(back).not.toHaveBeenCalled()
        back.mockRestore()
    })

    it('releasing an escape-dismissed layer unwinds its entry and swallows the resulting pop', () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {})
        const id = pushSheetHistoryLayer(() => {})

        releaseSheetHistoryLayer(id) // dismissed via Escape/backdrop/selection
        expect(back).toHaveBeenCalledTimes(1)

        // The programmatic back() produces one popstate that must not reach
        // the app's URL handler.
        expect(consumePopstateForSheetLayers()).toBe(true)
        expect(consumePopstateForSheetLayers()).toBe(false)
        back.mockRestore()
    })

    it('does not unwind when the app navigated on top of the sheet', () => {
        const back = jest.spyOn(window.history, 'back').mockImplementation(() => {})
        const id = pushSheetHistoryLayer(() => {})
        window.history.pushState({ app: true }, '', window.location.href) // in-sheet navigation

        releaseSheetHistoryLayer(id)
        expect(back).not.toHaveBeenCalled() // unwinding would eat the real entry
        back.mockRestore()
    })

    it('withSheetHistoryLayers falls through to the app handler when no layer is open', () => {
        const fallback = jest.fn()
        const handler = withSheetHistoryLayers(fallback)

        pushSheetHistoryLayer(() => {})
        handler({}) // consumed by the layer
        expect(fallback).not.toHaveBeenCalled()

        handler({}) // nothing open: the app navigates
        expect(fallback).toHaveBeenCalledTimes(1)
    })
})
