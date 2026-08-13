/**
 * @jest-environment jsdom
 *
 * ModalShell (MODAL_IMPROVEMENT_PLAN.md, Phase 2): AppPopover renders the
 * anchored react-tiny-popover on desktop and the BottomSheet below
 * MODAL_SHEET_BREAKPOINT, with the AT-2236 mount-grace guard, the LIFO Escape
 * stack and the document scroll lock baked in.
 *
 * Real timers throughout, mirroring GlobalSearchModal.dismissRace.test.js:
 * react-native-web's Animated captures requestAnimationFrame at module load,
 * so Jest's fake timers never flush its frames — and a frozen clock breaks the
 * timestamp premises of the dismiss guard. The prefers-reduced-motion mock
 * makes the animations effectively instant instead. The full composition
 * (real Chromium event timing, real touch) is covered by
 * browser-tests/modalsheet.
 */
import React from 'react'
import { Text } from 'react-native'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'

import AppPopover from './AppPopover'
import { highResNow } from '../../../utils/popupDismissGuard'
import { installEscapeStack, resetEscapeStack } from '../../../utils/escapeStack'
import { consumePopstateForSheetLayers, resetSheetHistoryLayers } from '../../../utils/sheetHistoryLayers'
import { isBodyScrollLocked } from '../../../utils/bodyScrollLock'
import { MODAL_SHEET_BREAKPOINT } from '../../styles/modals'

const pressWith = (node, timeStamp) => {
    const events = ['mousedown', 'mouseup', 'click'].map(type => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
        if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
        return event
    })
    act(() => {
        events.forEach(event => node.dispatchEvent(event))
    })
}

const pressEscape = () => {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
}

// Lets the (instant, reduced-motion) exit animation deliver its completion
// callback through the real requestAnimationFrame.
const settle = () =>
    act(async () => {
        await new Promise(resolve => setTimeout(resolve, 60))
    })

const sheetNode = () => document.querySelector('[data-testid="bottom-sheet"]')
const backdropNode = () => document.querySelector('[data-testid="bottom-sheet-backdrop"]')
const handleNode = () => document.querySelector('[data-testid="bottom-sheet-handle"]')

const dispatchPointer = (node, type, clientY, pointerId = 1) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
        button: { value: 0 },
        clientY: { value: clientY },
        isPrimary: { value: true },
        pointerId: { value: pointerId },
        pointerType: { value: 'touch' },
    })
    act(() => node.dispatchEvent(event))
    return event
}

const dispatchTouch = (node, type, clientY, identifier = 1) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const touch = { clientY, identifier }
    Object.defineProperties(event, {
        changedTouches: { value: [touch] },
        touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [touch] },
    })
    act(() => node.dispatchEvent(event))
    return event
}

describe('ModalShell', () => {
    let container
    let root
    let uninstallEscape

    const renderShell = ({ isOpen = true, onClickOutside = () => {}, content } = {}) => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => {
            root.render(
                <AppPopover
                    isOpen={isOpen}
                    onClickOutside={onClickOutside}
                    content={content || <Text>SHEET CONTENT</Text>}
                    position={['bottom']}
                    align={'end'}
                >
                    <Text>TRIGGER</Text>
                </AppPopover>
            )
        })
    }

    beforeEach(() => {
        window.matchMedia = jest.fn(() => ({ matches: true, addListener: () => {}, removeListener: () => {} }))
        resetEscapeStack()
        resetSheetHistoryLayers()
        uninstallEscape = installEscapeStack()
    })

    afterEach(async () => {
        act(() => root && root.unmount())
        await settle()
        container && container.remove()
        if (uninstallEscape) uninstallEscape()
        delete window.ontouchstart
        delete window.matchMedia
    })

    describe('presentation switch', () => {
        it('renders the bottom sheet below the breakpoint', async () => {
            window.innerWidth = MODAL_SHEET_BREAKPOINT - 140
            window.innerHeight = 700
            renderShell()
            await settle()
            expect(sheetNode()).toBeTruthy()
            expect(backdropNode()).toBeTruthy()
            expect(document.body.textContent).toContain('SHEET CONTENT')
            expect(document.body.textContent).toContain('TRIGGER')
        })

        it('renders the anchored popover, not a sheet, on desktop', async () => {
            window.innerWidth = 1024
            window.innerHeight = 768
            renderShell()
            await settle()
            expect(sheetNode()).toBeNull()
            expect(document.body.textContent).toContain('TRIGGER')
        })

        it('renders nothing extra while closed', () => {
            window.innerWidth = 500
            window.innerHeight = 700
            renderShell({ isOpen: false })
            expect(sheetNode()).toBeNull()
            expect(document.body.textContent).toContain('TRIGGER')
        })
    })

    describe('dismissal', () => {
        beforeEach(() => {
            window.innerWidth = 500
            window.innerHeight = 700
        })

        it('closes on a genuine backdrop press', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            pressWith(backdropNode(), highResNow() + 1000)
            await settle()

            expect(onClickOutside).toHaveBeenCalledTimes(1)
        })

        it('ignores a backdrop press the browser queued before the sheet existed (AT-2236)', async () => {
            const queuedAt = highResNow() - 5
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })

            pressWith(backdropNode(), queuedAt)
            await settle()

            expect(onClickOutside).not.toHaveBeenCalled()
        })

        it('ignores the repeat tap of an impatient user on a touch device', async () => {
            window.ontouchstart = null
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })

            pressWith(backdropNode(), 0)
            await settle()

            expect(onClickOutside).not.toHaveBeenCalled()
        })

        it('closes on Escape through the escape stack', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            pressEscape()
            await settle()

            expect(onClickOutside).toHaveBeenCalledTimes(1)
        })

        it('closes on a browser back press (Phase 5 history layer)', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            // What AppContent's wrapped window.onpopstate does on back.
            act(() => {
                expect(consumePopstateForSheetLayers()).toBe(true)
            })
            await settle()

            expect(onClickOutside).toHaveBeenCalledTimes(1)
        })

        it('closes only once for a backdrop press followed by Escape', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            pressWith(backdropNode(), highResNow() + 1000)
            pressEscape()
            await settle()

            expect(onClickOutside).toHaveBeenCalledTimes(1)
        })

        it('dismisses on a deliberate downward handle drag', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            dispatchPointer(handleNode(), 'pointerdown', 100)
            dispatchPointer(window, 'pointermove', 220)
            dispatchPointer(window, 'pointerup', 220)
            await settle()

            expect(onClickOutside).toHaveBeenCalledTimes(1)
        })

        it('handles a native touch-only drag without any pointer events', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            const touchStart = dispatchTouch(handleNode(), 'touchstart', 100)
            const touchMove = dispatchTouch(window, 'touchmove', 220)
            dispatchTouch(window, 'touchend', 220)
            await settle()

            expect(touchStart.defaultPrevented).toBe(true)
            expect(touchMove.defaultPrevented).toBe(true)
            expect(onClickOutside).toHaveBeenCalledTimes(1)
        })

        it('gives the visible handle a thumb-sized non-shrinking hit target', async () => {
            renderShell()
            await settle()

            const style = window.getComputedStyle(handleNode())
            expect(style.height).toBe('36px')
            expect(style.flexShrink).toBe('0')
        })

        it('keeps the sheet open after a tiny or upward handle drag', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            dispatchPointer(handleNode(), 'pointerdown', 100)
            dispatchPointer(window, 'pointermove', 108)
            dispatchPointer(window, 'pointerup', 108)
            dispatchPointer(handleNode(), 'pointerdown', 100, 2)
            dispatchPointer(window, 'pointermove', -100, 2)
            dispatchPointer(window, 'pointerup', -100, 2)
            await settle()

            expect(onClickOutside).not.toHaveBeenCalled()
        })

        it('does not claim gestures that begin in scrollable sheet content', async () => {
            const onClickOutside = jest.fn()
            renderShell({
                onClickOutside,
                content: <div data-testid={'scrollable-sheet-content'}>SCROLLABLE CONTENT</div>,
            })
            await settle()

            const content = document.querySelector('[data-testid="scrollable-sheet-content"]')
            dispatchPointer(content, 'pointerdown', 100)
            const moveEvent = dispatchPointer(window, 'pointermove', 240)
            dispatchPointer(window, 'pointerup', 240)
            dispatchTouch(content, 'touchstart', 100)
            const touchMoveEvent = dispatchTouch(window, 'touchmove', 240)
            dispatchTouch(window, 'touchend', 240)
            await settle()

            expect(onClickOutside).not.toHaveBeenCalled()
            expect(moveEvent.defaultPrevented).toBe(false)
            expect(touchMoveEvent.defaultPrevented).toBe(false)
        })
    })

    describe('focus trap (Phase 5 a11y)', () => {
        const pressTab = (shiftKey = false) => {
            act(() => {
                document.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
                )
            })
        }

        it('cycles Tab within the sheet and pulls outside focus in', async () => {
            window.innerWidth = 500
            window.innerHeight = 700
            renderShell({
                content: (
                    <>
                        <button data-testid={'first-button'}>first</button>
                        <button data-testid={'second-button'}>second</button>
                    </>
                ),
            })
            await settle()

            const first = document.querySelector('[data-testid="first-button"]')
            const second = document.querySelector('[data-testid="second-button"]')

            // Focus is outside the sheet (body): Tab pulls it to the first
            // focusable inside instead of walking the app behind the scrim.
            pressTab()
            expect(document.activeElement).toBe(first)

            // Tab from the last focusable wraps to the first.
            second.focus()
            pressTab()
            expect(document.activeElement).toBe(first)

            // Shift+Tab from the first wraps to the last.
            pressTab(true)
            expect(document.activeElement).toBe(second)
        })
    })

    describe('exit animation (Phase 5 deferred unmount)', () => {
        it('keeps the sheet mounted for the exit animation, then removes it', async () => {
            window.innerWidth = 500
            window.innerHeight = 700
            renderShell()
            await settle()
            expect(sheetNode()).toBeTruthy()

            act(() => {
                root.render(
                    <AppPopover isOpen={false} onClickOutside={() => {}} content={<Text>SHEET CONTENT</Text>}>
                        <Text>TRIGGER</Text>
                    </AppPopover>
                )
            })
            // Still in the DOM right after close — the slide-out is playing.
            expect(sheetNode()).toBeTruthy()
            // And the dying sheet must not swallow taps.
            expect(sheetNode().style.pointerEvents).toBe('none')

            await settle()
            expect(sheetNode()).toBeNull()
        })

        it('re-opening mid-exit cancels the pending unmount', async () => {
            window.innerWidth = 500
            window.innerHeight = 700
            renderShell()
            await settle()

            const rerender = isOpen =>
                act(() => {
                    root.render(
                        <AppPopover isOpen={isOpen} onClickOutside={() => {}} content={<Text>SHEET CONTENT</Text>}>
                            <Text>TRIGGER</Text>
                        </AppPopover>
                    )
                })

            rerender(false)
            rerender(true)
            await settle()
            expect(sheetNode()).toBeTruthy()
            expect(sheetNode().style.pointerEvents).not.toBe('none')
        })
    })

    describe('document scroll lock', () => {
        it('locks the body scroller while the sheet is open and releases it on unmount', async () => {
            window.innerWidth = 500
            window.innerHeight = 700
            renderShell()
            await settle()
            expect(isBodyScrollLocked()).toBe(true)
            expect(document.body.style.overflowY).toBe('hidden')

            act(() => root.unmount())
            await settle()
            expect(isBodyScrollLocked()).toBe(false)
            expect(document.body.style.overflowY).not.toBe('hidden')
        })
    })
})
