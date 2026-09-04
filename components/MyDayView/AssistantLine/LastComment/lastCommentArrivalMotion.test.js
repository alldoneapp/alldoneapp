/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import {
    COMPACT_CARD_HEIGHT,
    ROLL_DURATION_MS,
    resolveRollDistance,
    useLastCommentArrivalMotion,
} from './lastCommentArrivalMotion'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './lastCommentLayout'

// `mock`-prefixed so jest's module-factory hoisting allows the reference.
const mockMotionPreference = { reduced: false }
jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => mockMotionPreference.reduced,
}))

const FIRST = { projectId: 'p1', commentText: 'The comment already on screen', objectName: 'Planning' }
const SECOND = { projectId: 'p1', commentText: 'The answer that just landed', objectName: 'Planning' }
const THIRD = { projectId: 'p1', commentText: 'And another one right after', objectName: 'Planning' }

const layoutEvent = height => ({ nativeEvent: { layout: { height } } })

/**
 * jest replaces `Animated.timing` with an inert stub (`__mocks__/react-native.js`) AND the hook
 * itself stands down when `NODE_ENV === 'test'`. A suite that leaves both in place asserts nothing:
 * every "no roll" expectation passes because there is never a roll. So the animated branch is
 * reached explicitly here, and the roll is advanced by hand through the value both rows interpolate
 * — the stub never advances one on its own.
 */
const withAnimationsEnabled = fn => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
        return fn()
    } finally {
        process.env.NODE_ENV = previous
    }
}

const renderMotion = ({ arrivalId = null, row = FIRST, compact = false } = {}) => {
    const frames = []
    const Probe = props => {
        const motion = useLastCommentArrivalMotion(props.arrivalId, props.row, props.compact)
        frames.push(motion)
        return <Text>motion</Text>
    }

    let tree
    const props = { arrivalId, row, compact }
    act(() => {
        tree = renderer.create(<Probe {...props} />)
    })

    const latest = () => frames[frames.length - 1]
    return {
        latest,
        layout: (height = LAST_COMMENT_PREVIEW_HEIGHT) =>
            act(() => {
                latest().onCardLayout(layoutEvent(height))
            }),
        /**
         * An arrival delivered in ONE commit. Convenient, and NOT the shape the app produces — a
         * comment for `arriveDeferred` below, which is the shape it does produce.
         */
        arrive: (nextId, nextRow) =>
            act(() => {
                Object.assign(props, { arrivalId: nextId, row: nextRow })
                tree.update(<Probe {...props} />)
            }),
        /**
         * The arrival as `LastUserOrAssistantCommentContainer` actually delivers it: the new comment
         * text paints first, and the `arrivalId` derived from it only lands in the NEXT commit,
         * because the container publishes it from an effect.
         *
         * That one-commit gap is what broke the roll in production. A card that captured "the row
         * painted last commit" had already advanced to the NEW row by the time it armed, so it
         * rolled the fresh answer out from under itself — two identical rows, which passes every
         * geometric assertion and reads as a rendering glitch.
         */
        arriveDeferred: (nextId, nextRow) => {
            act(() => {
                Object.assign(props, { row: nextRow })
                tree.update(<Probe {...props} />)
            })
            act(() => {
                Object.assign(props, { arrivalId: nextId })
                tree.update(<Probe {...props} />)
            })
        },
        drive: value =>
            act(() => {
                latest().rollValue.setValue(value)
            }),
        unmount: () => act(() => tree.unmount()),
    }
}

const outgoingY = motion => motion.outgoingStyle.transform[0].translateY.__getValue()
const incomingY = motion => motion.incomingStyle.transform[0].translateY.__getValue()
const badgeScale = motion => motion.badgeStyle.transform[0].scale.__getValue()

describe('lastCommentArrivalMotion — the ticker roll', () => {
    beforeEach(() => {
        mockMotionPreference.reduced = false
    })

    describe('resting state', () => {
        /**
         * The card renders complete on every first paint, reload and navigation. A hook seeded at
         * the START of its roll would leave those rolled off the top of the card on any renderer
         * where the animation never runs — i.e. an empty card.
         */
        it('rests with the comment in place and nothing rolling', () => {
            const motion = renderMotion().latest()
            expect(incomingY(motion)).toBe(0)
            expect(motion.outgoingRow).toBeNull()
            expect(badgeScale(motion)).toBe(1)
        })

        it('mounts no outgoing row just because the card was measured', () => {
            const probe = renderMotion()
            probe.layout()
            expect(probe.latest().outgoingRow).toBeNull()
        })
    })

    describe('an arrival', () => {
        it('rolls the comment that WAS on screen, not the one that just arrived', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.arrive(1, SECOND)
                expect(probe.latest().outgoingRow).toEqual(FIRST)
            })
        })

        /**
         * The same claim, against the delivery the app really makes. This is the case that was
         * broken in production: with a one-slot "last painted row" ref the outgoing row here is
         * SECOND — the comment that just arrived, rolling out from under itself.
         */
        it('still rolls the previous comment when the id lands a commit after the text', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.arriveDeferred(1, SECOND)
                expect(probe.latest().outgoingRow).toEqual(FIRST)
            })
        })

        it('chains deferred arrivals without ever repeating the arriving comment', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.arriveDeferred(1, SECOND)
                probe.arriveDeferred(2, THIRD)
                expect(probe.latest().outgoingRow).toEqual(SECOND)
            })
        })

        /**
         * A card BORN showing the arriving comment — the remount case, which is the ordinary shape
         * for a heartbeat or a VM result — has nothing to roll away and must not invent one. The
         * incoming row still rises into place, so the arrival is announced either way.
         */
        it('mounts no outgoing row when the card never showed a different comment', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: SECOND })
                probe.arrive(1, SECOND)
                expect(probe.latest().outgoingRow).toBeNull()
                expect(incomingY(probe.latest())).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
            })
        })

        /**
         * The start frame has to be in place before the browser paints, or the arrival flashes: the
         * new comment appears finished and then falls back down to roll in. That is why the values
         * are reset in a LAYOUT effect — with a passive one, `browser-tests/at2511` measured
         * `outgoing y: -90` on the first painted frame and `-0.06` on the next.
         *
         * `react-test-renderer` runs layout effects synchronously inside `act`, so "the start frame
         * is ready before anything downstream of the commit runs" is checkable here — what it
         * cannot check is that the browser had not already painted, which is the harness's job.
         */
        it('starts with the old comment in place and the new one a full card below', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.layout(LAST_COMMENT_PREVIEW_HEIGHT)
                probe.arrive(1, SECOND)

                expect(outgoingY(probe.latest())).toBe(0)
                expect(incomingY(probe.latest())).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
            })
        })

        /**
         * The load-bearing contract: ONE `Animated.Value` drives both rows, so they cannot drift
         * apart. Two values, however carefully tuned, read as two animations that happen to overlap
         * — and any gap between them would show as a band of empty card between the two comments.
         */
        it('keeps the two rows exactly one card apart for the whole roll', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.layout(LAST_COMMENT_PREVIEW_HEIGHT)
                probe.arrive(1, SECOND)

                ;[0, 0.25, 0.5, 0.75, 1].forEach(value => {
                    probe.drive(value)
                    expect(incomingY(probe.latest()) - outgoingY(probe.latest())).toBeCloseTo(
                        LAST_COMMENT_PREVIEW_HEIGHT,
                        5
                    )
                })
            })
        })

        it('ends with the new comment in place and the old one fully out of the card', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.layout(LAST_COMMENT_PREVIEW_HEIGHT)
                probe.arrive(1, SECOND)
                probe.drive(1)

                expect(incomingY(probe.latest())).toBe(0)
                expect(outgoingY(probe.latest())).toBe(-LAST_COMMENT_PREVIEW_HEIGHT)
            })
        })

        it('rolls upward — the old comment never travels down', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.layout(LAST_COMMENT_PREVIEW_HEIGHT)
                probe.arrive(1, SECOND)

                ;[0, 0.5, 1].forEach(value => {
                    probe.drive(value)
                    expect(outgoingY(probe.latest())).toBeLessThanOrEqual(0)
                    expect(incomingY(probe.latest())).toBeGreaterThanOrEqual(0)
                })
            })
        })

        it('arms the badge pop below full size', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1, SECOND)
                expect(badgeScale(probe.latest())).toBeLessThan(1)
                expect(badgeScale(probe.latest())).toBeGreaterThan(0)
            })
        })

        /**
         * A second copy of the comment left parked off-screen inside the clip would be invisible
         * and still subscribed to redux through its hashtag/mention/project tags.
         */
        it('unmounts the outgoing row once it has left', () => {
            jest.useFakeTimers()
            try {
                withAnimationsEnabled(() => {
                    const probe = renderMotion({ row: FIRST })
                    probe.arrive(1, SECOND)
                    expect(probe.latest().outgoingRow).toEqual(FIRST)

                    act(() => {
                        jest.advanceTimersByTime(ROLL_DURATION_MS + 200)
                    })
                    expect(probe.latest().outgoingRow).toBeNull()
                })
            } finally {
                jest.useRealTimers()
            }
        })

        /**
         * The finished roll must STAY finished. Clearing the run's id on completion would make the
         * render-phase arm true again on the next render — `arrivalId` has not changed, it is still
         * the one just handled — and the card would roll the same comment away over and over.
         */
        it('does not roll again after it has finished, with no new arrival', () => {
            jest.useFakeTimers()
            try {
                withAnimationsEnabled(() => {
                    const probe = renderMotion({ row: FIRST })
                    probe.arrive(1, SECOND)

                    act(() => {
                        jest.advanceTimersByTime(ROLL_DURATION_MS + 200)
                    })
                    // An ordinary re-render with the same arrival still in place.
                    probe.arrive(1, SECOND)
                    expect(probe.latest().outgoingRow).toBeNull()

                    act(() => {
                        jest.advanceTimersByTime(ROLL_DURATION_MS + 200)
                    })
                    expect(probe.latest().outgoingRow).toBeNull()
                })
            } finally {
                jest.useRealTimers()
            }
        })

        it('rolls the comment in between away on a second arrival', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.arrive(1, SECOND)
                probe.drive(1)
                probe.arrive(2, THIRD)

                expect(probe.latest().outgoingRow).toEqual(SECOND)
                expect(incomingY(probe.latest())).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
            })
        })
    })

    describe('the roll distance', () => {
        it('is the card height the renderer actually measured', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.layout(140)
                probe.arrive(1, SECOND)
                expect(incomingY(probe.latest())).toBe(140)
            })
        })

        // Never a guess: an unmeasured card falls back to the height it is declared with.
        it('falls back to the card’s own constant height', () => {
            expect(resolveRollDistance(0, false)).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
            expect(resolveRollDistance(0, true)).toBe(COMPACT_CARD_HEIGHT)
        })

        it('prefers a real measurement over the constant', () => {
            expect(resolveRollDistance(140, false)).toBe(140)
            expect(resolveRollDistance(31, true)).toBe(31)
        })

        it('rolls the compact chip by its own smaller height', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST, compact: true })
                probe.arrive(1, SECOND)
                expect(incomingY(probe.latest())).toBe(COMPACT_CARD_HEIGHT)
            })
        })
    })

    describe('reduced motion', () => {
        it('renders the finished frame with no outgoing row at all', () => {
            mockMotionPreference.reduced = true
            withAnimationsEnabled(() => {
                const probe = renderMotion({ row: FIRST })
                probe.layout()
                probe.arrive(1, SECOND)

                expect(probe.latest().outgoingRow).toBeNull()
                expect(incomingY(probe.latest())).toBe(0)
                expect(badgeScale(probe.latest())).toBe(1)
            })
        })
    })

    describe('under jest', () => {
        // The house convention: every animation in this codebase is inert in tests, so suites never
        // have to advance timers to reach a stable tree.
        it('is inert without an explicit opt-out', () => {
            const probe = renderMotion({ row: FIRST })
            probe.arrive(1, SECOND)
            probe.layout()
            expect(probe.latest().outgoingRow).toBeNull()
            expect(incomingY(probe.latest())).toBe(0)
        })
    })

    it('stops the roll when the card unmounts mid-arrival', () => {
        withAnimationsEnabled(() => {
            const probe = renderMotion({ row: FIRST })
            probe.arrive(1, SECOND)
            expect(() => probe.unmount()).not.toThrow()
        })
    })
})
