/**
 * @jest-environment jsdom
 *
 * AT-2397 — the @-mention list must paint ABOVE the popup that hosts the input.
 *
 * react-tiny-popover portals every popover to `document.body`, so the mention
 * list is a SIBLING of the "Add task" popup in the root stacking context, not a
 * descendant of it — being nested in the React tree decides nothing. The
 * vendored `createContainer` only ever sets overflow/position/top/left, so a
 * popover that passes no `containerStyle` is left at `z-index: auto` and loses
 * to any sibling that sets one. The "Add task" popup sets `zIndex: 9999`
 * (components/Tags/AddTaskTag.js) and the mobile bottom sheet MODAL_Z_CONTENT,
 * so typing "@" in either opened the list behind the card: positioned, painted,
 * and completely invisible.
 *
 * These tests drive the REAL vendored library rather than asserting on props.
 * The defect lived in the seam between the wrapper and `createContainer`, and a
 * mocked Popover reproduces neither half of it: it would happily "pass" while
 * the container div carried no z-index at all.
 */
import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import fs from 'fs'
import path from 'path'

import { MODAL_Z_AUTOCOMPLETE, MODAL_Z_CONTENT } from '../../styles/modals'

const Popover = require('react-tiny-popover').default

// The list itself is irrelevant to layering, and rendering it for real drags in
// Typesense, the redux store and the whole contact search stack.
jest.mock('./MentionsModal', () => {
    const React = require('react')
    return function MentionsModalStub() {
        return React.createElement('div', { 'data-testid': 'mentions' }, 'mentions')
    }
})

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useDispatch: jest.fn(() => () => {}),
    useSelector: jest.fn(selector => selector({ smallScreenNavigation: false, openModals: {} })),
}))

const WrapperMentionsModal = require('./WrapperMentionsModal').default

const VIEWPORT_WIDTH = 1280
const VIEWPORT_HEIGHT = 800

// The z-index the "Add task" popup actually ships with today
// (components/Tags/AddTaskTag.js). Hard-coded on purpose: this test is the
// thing that must fail if that popup ever climbs past the mention layer.
const ADD_TASK_POPUP_Z_INDEX = 9999

const CARET_LOCATION = { top: 200, left: 300 }

describe('mention popup layering (AT-2397)', () => {
    let host
    let root
    // Every extra popover root mounted by a test, torn down in afterEach so one
    // test's portal can never leak into the next one's container query.
    let extraRoots

    const setViewport = (width, height) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    }

    // jsdom has no layout; give the popover a plausible natural size so the
    // vendored placement code runs its normal path.
    const mockLayout = () => {
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
            if (this.classList && this.classList.contains('react-tiny-popover-container')) {
                const top = parseFloat(this.style.top) || 0
                const left = parseFloat(this.style.left) || 0
                return { top, left, width: 305, height: 240, right: left + 305, bottom: top + 240 }
            }
            return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }
        })
    }

    const containers = () => Array.from(document.querySelectorAll('.react-tiny-popover-container'))

    const renderMentions = () => {
        act(() => {
            root.render(
                <WrapperMentionsModal
                    mentionText="ka"
                    selectItemToMention={() => {}}
                    projectId="project-1"
                    contentLocation={CARET_LOCATION}
                    setMentionModalHeight={() => {}}
                    keepFocus={() => {}}
                    inMentionsEditionTag={false}
                    insertNormalMention={() => {}}
                />
            )
        })
        return containers()[containers().length - 1]
    }

    // A stand-in for the "Add task" popup: same library, same portal target,
    // same containerStyle shape.
    const renderHostPopup = containerStyle => {
        const node = document.createElement('div')
        document.body.appendChild(node)
        const popupRoot = createRoot(node)
        extraRoots.push({ root: popupRoot, node })
        act(() => {
            popupRoot.render(
                <Popover content={<div>add task card</div>} isOpen={true} containerStyle={containerStyle}>
                    <span />
                </Popover>
            )
        })
        return containers()[containers().length - 1]
    }

    beforeEach(() => {
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        window.getSelection = () => ({ toString: () => '' })
        setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
        mockLayout()
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        extraRoots = []
    })

    afterEach(() => {
        act(() => {
            extraRoots.forEach(entry => entry.root.unmount())
            root.unmount()
        })
        extraRoots.forEach(entry => entry.node.remove())
        host.remove()
        containers().forEach(node => node.remove())
        jest.restoreAllMocks()
    })

    it('puts the mention portal on the autocomplete layer', () => {
        const container = renderMentions()

        expect(container).not.toBeNull()
        expect(container.style.zIndex).toBe(String(MODAL_Z_AUTOCOMPLETE))
    })

    it('outranks the "Add task" popup even when that popup is portaled last', () => {
        // DOM order deliberately against us: the mention list mounts FIRST, so
        // only the z-index can save it. Before the fix the mention container had
        // no z-index and lost here no matter what.
        const mentionContainer = renderMentions()
        const popupContainer = renderHostPopup({ zIndex: ADD_TASK_POPUP_Z_INDEX, overflow: 'visible' })

        expect(Number(mentionContainer.style.zIndex)).toBeGreaterThan(Number(popupContainer.style.zIndex))
    })

    it('pins the defect: a popover that passes no containerStyle gets z-index auto', () => {
        // This is exactly the state WrapperMentionsModal was in, and the reason
        // nesting inside the popup's React tree did not help. If the vendored
        // container ever starts defaulting to a z-index, this test is the
        // signal to revisit the fix rather than silently rely on it.
        const container = renderHostPopup(undefined)

        expect(container.style.zIndex).toBe('')
    })

    it('outranks the mobile bottom sheet that hosts the same input', () => {
        // Below MODAL_SHEET_BREAKPOINT the "Add task" popup renders as a
        // BottomSheet at MODAL_Z_CONTENT instead of a popover, so the mention
        // layer has to clear that too.
        expect(MODAL_Z_CONTENT).toBeLessThan(MODAL_Z_AUTOCOMPLETE)
    })
})

describe('mention layer guardrail (AT-2397)', () => {
    const ROOT = path.join(__dirname, '..', '..', '..')
    const SCANNED_DIRS = ['components', 'utils', 'hooks']

    const collectJsFiles = dir => {
        const results = []
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '__snapshots__' || entry.name.startsWith('.')) continue
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) results.push(...collectJsFiles(fullPath))
            else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) results.push(fullPath)
        }
        return results
    }

    it('keeps every popover portal container below the mention layer', () => {
        // Scoped to `containerStyle` on purpose. Those are the popover PORTAL
        // containers — the body-level siblings the mention list actually
        // competes with. In-tree zIndex values elsewhere (toasts, the task
        // completion animation) are a different question and are allowed to sit
        // above it.
        const offenders = []

        for (const file of SCANNED_DIRS.flatMap(dir => collectJsFiles(path.join(ROOT, dir)))) {
            const source = fs.readFileSync(file, 'utf8')
            // `containerStyle={{ ... zIndex: N ... }}` and the hoisted
            // `const FOO_CONTAINER_STYLE = { zIndex: N }` convention alike.
            const styleObjects = source.match(/(?:containerStyle\s*=\s*\{\{|CONTAINER_STYLE\s*=\s*\{)[^}]*\}/g) || []
            for (const styleObject of styleObjects) {
                const match = styleObject.match(/zIndex:\s*(\d+)/)
                if (match && Number(match[1]) >= MODAL_Z_AUTOCOMPLETE) {
                    offenders.push(`${path.relative(ROOT, file)} -> ${match[1]}`)
                }
            }
        }

        expect(offenders).toEqual([])
    })
})
