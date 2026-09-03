import React from 'react'
import renderer, { act } from 'react-test-renderer'

import UndoActionBar from './UndoActionBar'
import {
    UNDO_ANIMATION_IDS,
    UNDO_DISPLAY_TIME_MS,
    UNDO_EXIT_MS,
    UNDO_EXIT_SETTLE_BUFFER_MS,
} from './undoActionBarMotion'

/**
 * AT-2503 — drives the REAL UndoActionBar through its REAL animated branch.
 *
 * Motion is inert under jest by convention here (`animationsAreDisabled()` keys off NODE_ENV, and
 * `__mocks__/react-native.js` stubs `Animated.timing`), so a suite that wants to see the animated
 * code path at all has to opt out of that AND out of reduced motion. `useReducedMotion` is mocked
 * to a VARIABLE defaulting to false — never to a constant. The cautionary tale is in CLAUDE.md: the
 * predecessor of the empty-inbox celebration was only ever tested with the preference forced on, so
 * the suite exercised the static branch forever and the animated one was never covered at all.
 *
 * What this file can and cannot see: `Animated.timing` is still a no-op, so nothing here observes a
 * value moving. What it observes is the LIFECYCLE the animation needs in order to exist — that the
 * banner survives its own dismissal long enough to animate out, that it leaves the way it arrived,
 * that a status flip does not restart the entry, and that reduced motion removes all of it. Those
 * are the parts a user notices when they are wrong; the pixels are `browser-tests/at2503`.
 */

const mockOnSnapshot = jest.fn()
let mockReducedMotion = false

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            loggedIn: true,
            loggedUser: { uid: 'user-1' },
        }),
}))
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        firestore: () => ({
            collection: () => ({
                orderBy: () => ({
                    limit: () => ({ onSnapshot: mockOnSnapshot }),
                }),
            }),
        }),
    },
}))
jest.mock('../../utils/undo/undoActions', () => ({ reverseUndoAction: jest.fn(() => Promise.resolve()) }))
jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { body2: {}, button: {} },
    colors: { Text01: '#000000', UtilityBlue200: '#0000FF' },
    hexColorToRGBa: () => 'rgba(0,0,0,0.8)',
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => mockReducedMotion,
}))

const { reverseUndoAction } = require('../../utils/undo/undoActions')

const buildAction = (overrides = {}) => ({
    actionId: 'action-1',
    createdAt: Date.now(),
    lastChangedAt: Date.now(),
    label: 'Moved task',
    status: 'applied',
    ...overrides,
})

const container = tree => tree.root.findAllByProps({ testID: 'undo-action-bar-container' }, { deep: false })[0]
const isMounted = tree => tree.root.findAllByProps({ testID: 'undo-action-bar' }, { deep: false }).length > 0
const countdowns = tree => tree.root.findAllByProps({ testID: 'undo-action-countdown' }, { deep: false })
const variantOf = tree => container(tree).props.dataSet.undoAnimation
const styleOf = tree => Object.assign({}, ...[].concat(container(tree).props.style).filter(Boolean))

const emit = (tree, action) =>
    act(() => {
        mockOnSnapshot.mock.calls[mockOnSnapshot.mock.calls.length - 1][0]({ docs: [{ data: () => action }] })
    })

const render = (action = buildAction()) => {
    let tree
    act(() => {
        tree = renderer.create(<UndoActionBar />)
    })
    emit(tree, action)
    return tree
}

describe('the Undo banner show/hide animation, wired up (AT-2503)', () => {
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        mockReducedMotion = false
        // Opt out of the repo-wide "animations are inert in jest" convention.
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        process.env.NODE_ENV = originalNodeEnv
    })

    it('gives an arriving banner one of the four animations and an animated style to run it', () => {
        const tree = render()

        expect(UNDO_ANIMATION_IDS).toContain(variantOf(tree))
        const style = styleOf(tree)
        expect(style.opacity).toBeDefined()
        expect(style.transform).toEqual(expect.any(Array))
        expect(style.transform.length).toBeGreaterThan(0)
    })

    /**
     * The whole reason the component could not keep `if (!visible) return null`: an exit animation
     * needs the thing it is animating to still be on screen.
     */
    it('keeps a dismissed banner mounted for its exit, then takes it away on the settle timer', () => {
        const tree = render()

        act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())

        expect(isMounted(tree)).toBe(true)
        expect(container(tree).props.dataSet.undoAnimationPhase).toBe('leaving')

        act(() => jest.advanceTimersByTime(UNDO_EXIT_MS + UNDO_EXIT_SETTLE_BUFFER_MS + 1))

        expect(isMounted(tree)).toBe(false)
    })

    it('leaves the way it arrived — the exit is the same variant as the entry', () => {
        const tree = render()
        const arrived = variantOf(tree)

        act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())

        expect(variantOf(tree)).toBe(arrived)
    })

    it('stops a leaving banner from swallowing a click meant for the app behind it', () => {
        const tree = render()

        expect(container(tree).props.pointerEvents).toBe('auto')
        act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())

        expect(container(tree).props.pointerEvents).toBe('none')
    })

    it('never plays the same animation twice in a row across consecutive appearances', () => {
        const tree = render(buildAction({ actionId: 'action-1' }))
        const seen = [variantOf(tree)]

        for (let round = 2; round <= 6; round++) {
            act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())
            act(() => jest.advanceTimersByTime(UNDO_EXIT_MS + UNDO_EXIT_SETTLE_BUFFER_MS + 1))
            emit(tree, buildAction({ actionId: `action-${round}`, lastChangedAt: Date.now() + round }))
            seen.push(variantOf(tree))
        }

        seen.forEach((variant, index) => {
            if (index > 0) expect(`#${index}: ${variant}`).not.toBe(`#${index}: ${seen[index - 1]}`)
        })
    })

    /**
     * Pressing Undo swaps the label to "Undone: …" in place. Replaying the entry would move the
     * Redo button out from under the cursor mid-interaction, so the banner stays exactly where it
     * is — same mount, same variant — and the beat is carried by the nudge instead.
     */
    it('treats a status flip as a content change, not as a new arrival', () => {
        const tree = render()
        const arrived = variantOf(tree)

        emit(tree, buildAction({ status: 'undone', lastChangedAt: Date.now() + 1 }))

        expect(isMounted(tree)).toBe(true)
        expect(variantOf(tree)).toBe(arrived)
        expect(container(tree).props.dataSet.undoAnimationPhase).toBe('shown')
    })

    describe('the ten-second countdown line', () => {
        it('draws while the auto-hide timer is actually running', () => {
            const tree = render()

            expect(countdowns(tree)).toHaveLength(1)
            expect(countdowns(tree)[0].props.pointerEvents).toBe('none')
        })

        /**
         * It must be `aria-hidden` and not the legacy `accessibilityElementsHidden` /
         * `importantForAccessibility` pair: react-native-web 0.21 forwards neither, so those would
         * look like an accessibility fix in review and do nothing in the browser.
         */
        it('is hidden from assistive technology by the one prop react-native-web forwards', () => {
            const tree = render()
            const line = countdowns(tree)[0]

            expect(line.props['aria-hidden']).toBe(true)
            expect(line.props.accessibilityElementsHidden).toBeUndefined()
            expect(line.props.importantForAccessibility).toBeUndefined()
        })

        it('is not drawn while an undo is in flight, because no timer is running then', async () => {
            reverseUndoAction.mockImplementation(() => new Promise(() => {}))
            const tree = render()

            await act(async () => {
                tree.root.findByProps({ testID: 'undo-action-button' }).props.onPress({ stopPropagation: jest.fn() })
            })

            expect(countdowns(tree)).toHaveLength(0)
        })

        it('is not drawn on a banner that is already leaving', () => {
            const tree = render()

            act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())

            expect(countdowns(tree)).toHaveLength(0)
        })

        it('drains over exactly the time the banner is given, so it cannot lie', () => {
            const tree = render()

            act(() => jest.advanceTimersByTime(UNDO_DISPLAY_TIME_MS - 1))
            expect(isMounted(tree)).toBe(true)

            act(() => jest.advanceTimersByTime(2))
            expect(container(tree).props.dataSet.undoAnimationPhase).toBe('leaving')
        })
    })

    describe('with prefers-reduced-motion', () => {
        beforeEach(() => {
            mockReducedMotion = true
        })

        it('shows the banner with no animated style at all', () => {
            const tree = render()

            expect(isMounted(tree)).toBe(true)
            const style = styleOf(tree)
            expect(style.transform).toBeUndefined()
            expect(style.opacity).toBeUndefined()
        })

        it('removes it in the same commit as the press, with no exit to wait out', () => {
            const tree = render()

            act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())

            expect(isMounted(tree)).toBe(false)
        })

        /**
         * The countdown is ten seconds of continuous movement — the exact shape of motion this
         * preference exists to suppress. It is dropped rather than frozen: a static full-width line
         * would state something untrue.
         */
        it('draws no countdown line', () => {
            const tree = render()

            expect(countdowns(tree)).toHaveLength(0)
        })
    })
})
