import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import { OVERFLOW_TOLERANCE_PX } from './notesToolbarOverflow'
import store from '../../../../redux/store'
import {
    toggleMiddleScreenNoteDV,
    toggleSmallScreenNavigation,
    toggleSmallScreenNavSidebarCollapsed,
} from '../../../../redux/actions'

/**
 * AT-2427 - the WIRING of the responsive note toolbar, against the real component.
 *
 * `notesToolbarOverflow.test.js` pins the decision (when the bar collapses, when it comes back,
 * that it cannot flap). It cannot say whether the toolbar actually acts on that decision, and
 * the wiring is where this class of bug lives: the group boundaries, which group carries Link,
 * and whether the "more" menu appears in its place. So this suite renders the REAL
 * `EditorToolbar` and reads the classes off the real DOM it produces.
 *
 * jsdom has no layout - every box measures 0x0 - so the geometry is supplied. But it is supplied
 * as a LAYOUT, not as an answer: each group is given a width, hidden groups measure zero exactly
 * as `display: none` ones do, and the real hook then measures that layout on a real resize event
 * and folds the real groups away. The widths are the input; which groups survive is the output.
 */

const AVAILABLE_WIDE = 100000
const AVAILABLE_NARROW = 1

// One width per visible toolbar item, so that folding the five controls after Link away genuinely
// buys room while the single "more" button that replaces them costs little.
const WIDTH_ITEM = 40
const WIDTH_MORE_BUTTON = 30
const WIDTH_GROUP_WITHOUT_ITEMS = 100

const isHidden = element => String(element.className || '').includes('ql-hide')

/**
 * A toolbar group is as wide as the items still showing inside it - which is the point: the
 * component hides individual items rather than regrouping them, so a group really does shrink as
 * its trailing controls fold away.
 */
const widthOf = element => {
    if (isHidden(element)) return 0
    if (element.querySelector('#text-more-popup-mobile')) return WIDTH_MORE_BUTTON
    const items = Array.from(element.querySelectorAll('.ql-toolbar-item'))
    if (!items.length) return WIDTH_GROUP_WITHOUT_ITEMS
    return items.reduce((total, item) => total + (isHidden(item) ? 0 : WIDTH_ITEM), 0)
}

/**
 * Lay the toolbar out on demand. The rects are computed at call time from what is visible right
 * now, so a group the component folds away between two measurements really does stop taking up
 * room - which is the whole thing the hook is reasoning about.
 */
const applyFakeLayout = (toolbar, availableWidth) => {
    Object.defineProperty(toolbar, 'clientWidth', { value: availableWidth, configurable: true })
    toolbar.getBoundingClientRect = () => ({ left: 0, right: availableWidth, width: availableWidth, height: 56 })

    const children = Array.from(toolbar.children)
    children.forEach(child => {
        child.getBoundingClientRect = () => {
            if (isHidden(child)) return { left: 0, right: 0, width: 0, height: 0 }
            let left = 0
            for (const sibling of children) {
                if (sibling === child) break
                left += widthOf(sibling)
            }
            const width = widthOf(child)
            return { left, right: left + width, width, height: 40 }
        }
    })
}

describe('note editor toolbar overflow wiring (AT-2427)', () => {
    let container
    let root
    let EditorToolbar

    beforeAll(() => {
        // Required before the module is imported: EditorToolbar registers Quill formats at module
        // scope, and Quill needs a selection API jsdom does not ship.
        if (!document.getSelection) document.getSelection = () => null
        EditorToolbar = require('./EditorToolbar').default
    })

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => {
            store.dispatch(toggleSmallScreenNavigation(false))
            store.dispatch(toggleSmallScreenNavSidebarCollapsed(false))
            store.dispatch(toggleMiddleScreenNoteDV(false))
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    const render = () => {
        act(() => {
            root.render(
                <Provider store={store}>
                    <EditorToolbar
                        project={{ id: 'project-1' }}
                        projectId={'project-1'}
                        accessGranted={true}
                        editors={[]}
                        peersSynced={true}
                        clicked={false}
                        setClicked={() => {}}
                        isFullscreen={false}
                        setFullscreen={() => {}}
                        renderTask={() => {}}
                        renderTimestamp={() => {}}
                        readOnly={false}
                        disabled={false}
                        connectionState={''}
                        scrollYPos={{ current: 0 }}
                        scrollRef={{ current: { scrollTo: () => {} } }}
                        getEditor={() => null}
                        autoStartTranscription={false}
                    />
                </Provider>
            )
        })
        return container.querySelector('#toolbar')
    }

    const settleAt = (toolbar, availableWidth) => {
        applyFakeLayout(toolbar, availableWidth)
        act(() => {
            window.dispatchEvent(new Event('resize'))
        })
    }

    /**
     * The width band the AT-2427 screenshot lives in: the smallest shortfall the bar is allowed
     * to react to at all (anything less is sub-pixel slack it deliberately tolerates). Derived
     * from the bar the component actually rendered rather than hardcoded, so adding a toolbar
     * button later moves this with it instead of quietly making the test assert the wrong stage.
     */
    const widthJustTooNarrowForFull = toolbar =>
        Array.from(toolbar.children).reduce((total, child) => total + widthOf(child), 0) - OVERFLOW_TOLERANCE_PX - 1

    const actionItems = toolbar => Array.from(toolbar.querySelectorAll('.ql-formats-actions'))

    const state = toolbar => ({
        linkVisible: !isHidden(toolbar.querySelector('.ql-formats-link')),
        actionsVisible: actionItems(toolbar).some(item => !isHidden(item)),
        moreVisible: !isHidden(toolbar.querySelector('#text-more-popup-mobile').parentElement),
    })

    it('keeps every control on the bar when there is room', () => {
        const toolbar = render()
        settleAt(toolbar, AVAILABLE_WIDE)

        expect(state(toolbar)).toEqual({ linkVisible: true, actionsVisible: true, moreVisible: false })
    })

    it('folds only the controls AFTER Link away when the bar runs out of room', () => {
        // This is the case in the AT-2427 screenshot: wide enough that nothing used to collapse,
        // too narrow for the row it was being asked to draw.
        const toolbar = render()
        settleAt(toolbar, AVAILABLE_WIDE)
        settleAt(toolbar, widthJustTooNarrowForFull(toolbar))

        expect(state(toolbar)).toEqual({ linkVisible: true, actionsVisible: false, moreVisible: true })
    })

    it('moves the folded actions into the more menu, and only those', () => {
        const toolbar = render()
        settleAt(toolbar, AVAILABLE_WIDE)
        settleAt(toolbar, widthJustTooNarrowForFull(toolbar))

        const menu = toolbar.querySelector('#text-more-popup-mobile')
        const rows = Array.from(menu.children)
        // Link is still out on the bar, so listing it here as well would be a duplicate.
        expect(rows.filter(row => !isHidden(row))).toHaveLength(5)
        expect(menu.querySelector('button.ql-image')).toBeTruthy()
        expect(menu.querySelectorAll('button.ql-list')).toHaveLength(2)
        expect(menu.querySelectorAll('button.ql-indent')).toHaveLength(2)
    })

    it('gives Link up too, but only once folding everything after it was not enough', () => {
        const toolbar = render()
        settleAt(toolbar, AVAILABLE_NARROW)

        expect(state(toolbar)).toEqual({ linkVisible: false, actionsVisible: false, moreVisible: true })
        // ...and now the menu is the only way to reach it, so it has to be listed.
        const menu = toolbar.querySelector('#text-more-popup-mobile')
        expect(Array.from(menu.children).filter(row => !isHidden(row))).toHaveLength(6)
    })

    it('brings the controls back when the room comes back', () => {
        const toolbar = render()
        settleAt(toolbar, AVAILABLE_NARROW)
        expect(state(toolbar).linkVisible).toBe(false)

        settleAt(toolbar, AVAILABLE_WIDE)
        expect(state(toolbar)).toEqual({ linkVisible: true, actionsVisible: true, moreVisible: false })
    })

    it('leaves phone widths exactly as they were: Link in the menu, from the first paint', () => {
        // The redux breakpoints stay as a floor, so a phone never depends on a measurement
        // landing before it draws a bar that fits.
        act(() => {
            store.dispatch(toggleSmallScreenNavigation(true))
        })
        const toolbar = render()

        expect(state(toolbar)).toEqual({ linkVisible: false, actionsVisible: false, moreVisible: true })
    })

    it('keeps the quill buttons mounted while they are folded away', () => {
        // Quill binds its toolbar handlers once, at editor construction. A button that is
        // unmounted and later remounted comes back inert, which is why the groups are hidden
        // with `ql-hide` instead of being conditionally rendered.
        const toolbar = render()
        settleAt(toolbar, AVAILABLE_NARROW)

        const folded = actionItems(toolbar)
        expect(folded).toHaveLength(5)
        expect(folded.every(isHidden)).toBe(true)
        // Hidden, but still in the document - so the handlers Quill bound to them survive.
        expect(folded.filter(item => item.querySelector('button.ql-image'))).toHaveLength(1)
        expect(folded.filter(item => item.querySelector('button.ql-list'))).toHaveLength(2)
        expect(folded.filter(item => item.querySelector('button.ql-indent'))).toHaveLength(2)
        const link = toolbar.querySelector('.ql-formats-link')
        expect(isHidden(link)).toBe(true)
        expect(link.isConnected).toBe(true)
    })
})
