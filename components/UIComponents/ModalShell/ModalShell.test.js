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

        it('closes only once for a backdrop press followed by Escape', async () => {
            const onClickOutside = jest.fn()
            renderShell({ onClickOutside })
            await settle()

            pressWith(backdropNode(), highResNow() + 1000)
            pressEscape()
            await settle()

            expect(onClickOutside).toHaveBeenCalledTimes(1)
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
