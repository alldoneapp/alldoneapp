/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import {
    ARRIVAL_BAND_PEAK_ALPHA,
    ARRIVAL_TOTAL_MS,
    RISE_DISTANCE,
    arrivalBandBackground,
    resolveBandWidth,
    useLastCommentArrivalMotion,
} from './lastCommentArrivalMotion'

// `mock`-prefixed so jest's module-factory hoisting allows the reference.
const mockMotionPreference = { reduced: false }
jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => mockMotionPreference.reduced,
}))

const LAYOUT = { nativeEvent: { layout: { width: 320 } } }

/**
 * jest replaces `Animated.timing` with an inert stub (`__mocks__/react-native.js`) AND the hook
 * itself stands down when `NODE_ENV === 'test'`. A suite that leaves both in place asserts nothing:
 * every "no band" expectation passes because there is never a band. So the animated branch is
 * reached explicitly here, and the START frame is what gets asserted — the stub never advances a
 * value, so a value sitting at its from-state is the proof that the animation was armed.
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

const renderMotion = ({ arrivalId = null } = {}) => {
    const frames = []
    const Probe = props => {
        const motion = useLastCommentArrivalMotion(props.arrivalId)
        frames.push(motion)
        return <Text>motion</Text>
    }

    let tree
    act(() => {
        tree = renderer.create(<Probe arrivalId={arrivalId} />)
    })

    const latest = () => frames[frames.length - 1]
    return {
        latest,
        layout: (event = LAYOUT) =>
            act(() => {
                latest().onCardLayout(event)
            }),
        arrive: nextId =>
            act(() => {
                tree.update(<Probe arrivalId={nextId} />)
            }),
        unmount: () => act(() => tree.unmount()),
    }
}

const opacityOf = motion => motion.contentStyle.opacity.__getValue()
const translateYOf = motion => motion.contentStyle.transform[0].translateY.__getValue()
const badgeScaleOf = motion => motion.badgeStyle.transform[0].scale.__getValue()

describe('lastCommentArrivalMotion', () => {
    beforeEach(() => {
        mockMotionPreference.reduced = false
    })

    describe('resting state', () => {
        // The card renders complete on every first paint, reload and navigation. A hook seeded at
        // the START of the animation would leave those invisible on any renderer where the
        // animation never runs.
        it('rests on the finished frame when nothing has arrived', () => {
            const motion = renderMotion().latest()
            expect(opacityOf(motion)).toBe(1)
            expect(translateYOf(motion)).toBe(0)
            expect(badgeScaleOf(motion)).toBe(1)
            expect(motion.showBand).toBe(false)
        })

        it('never bands without an arrival, even once measured', () => {
            const probe = renderMotion()
            probe.layout()
            expect(probe.latest().showBand).toBe(false)
        })
    })

    describe('an arrival', () => {
        it('arms the rise from below at full transparency', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                expect(opacityOf(probe.latest())).toBe(0)
                expect(translateYOf(probe.latest())).toBe(RISE_DISTANCE)
            })
        })

        it('arms the badge pop below full size', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                expect(badgeScaleOf(probe.latest())).toBeLessThan(1)
                expect(badgeScaleOf(probe.latest())).toBeGreaterThan(0)
            })
        })

        it('shows the band only once the card has been measured', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                expect(probe.latest().showBand).toBe(false)
                probe.layout()
                expect(probe.latest().showBand).toBe(true)
            })
        })

        // A guessed width would sweep the wrong distance; an unmeasurable renderer gets no band.
        it('renders no band on a renderer that reports no width', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                probe.layout({ nativeEvent: { layout: { width: 0 } } })
                expect(probe.latest().showBand).toBe(false)
            })
        })

        it('sweeps the band from fully off the left edge to fully past the right', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                probe.layout()

                const { bandStyle } = probe.latest()
                const bandWidth = resolveBandWidth(320)
                expect(bandStyle.width).toBe(bandWidth)
                expect(bandStyle.transform[0].translateX.__getValue()).toBe(-bandWidth)
            })
        })

        // A hard-edged accent rectangle sliding over the card is worse than no band at all, so the
        // gradient is the only paint and there is deliberately no backgroundColor fallback.
        it('paints the band as a gradient with no solid fallback', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                probe.layout()
                expect(probe.latest().bandStyle.backgroundImage).toBe(arrivalBandBackground)
                expect(probe.latest().bandStyle.backgroundColor).toBeUndefined()
            })
        })

        it('retires the band once it has left the card', () => {
            jest.useFakeTimers()
            try {
                withAnimationsEnabled(() => {
                    const probe = renderMotion()
                    probe.arrive(1)
                    probe.layout()
                    expect(probe.latest().showBand).toBe(true)

                    act(() => {
                        jest.advanceTimersByTime(ARRIVAL_TOTAL_MS + 200)
                    })
                    expect(probe.latest().showBand).toBe(false)
                })
            } finally {
                jest.useRealTimers()
            }
        })

        it('restarts for a second arrival instead of ignoring it', () => {
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                probe.latest().contentStyle.opacity.setValue(1)
                probe.arrive(2)
                expect(opacityOf(probe.latest())).toBe(0)
            })
        })
    })

    describe('reduced motion', () => {
        it('renders the finished frame and no band', () => {
            mockMotionPreference.reduced = true
            withAnimationsEnabled(() => {
                const probe = renderMotion()
                probe.arrive(1)
                probe.layout()

                expect(opacityOf(probe.latest())).toBe(1)
                expect(translateYOf(probe.latest())).toBe(0)
                expect(badgeScaleOf(probe.latest())).toBe(1)
                expect(probe.latest().showBand).toBe(false)
            })
        })
    })

    describe('under jest', () => {
        // The house convention: every animation in this codebase is inert in tests, so suites never
        // have to advance timers to reach a stable tree.
        it('is inert without an explicit opt-out', () => {
            const probe = renderMotion()
            probe.arrive(1)
            probe.layout()
            expect(opacityOf(probe.latest())).toBe(1)
            expect(probe.latest().showBand).toBe(false)
        })
    })

    /**
     * The stops used to be built with `hexColorToRGBa(colors.Primary100, 0)`, whose alpha branch is
     * `if (alpha)` — so `0` fell through to an OPAQUE `rgb(...)` and the "soft band" was in fact a
     * hard accent rectangle. `browser-tests/at2511` is what actually caught it (jsdom computes no
     * gradient), but the string itself is checkable here, so it is.
     */
    describe('the band gradient', () => {
        const stops = () => arrivalBandBackground.match(/rgba?\([^)]*\)/g) || []

        it('fades to fully transparent at both edges', () => {
            expect(stops()).toHaveLength(3)
            expect(stops()[0]).toMatch(/rgba\(\d+,\d+,\d+,0\)/)
            expect(stops()[2]).toMatch(/rgba\(\d+,\d+,\d+,0\)/)
        })

        it('never emits an opaque rgb() stop', () => {
            expect(arrivalBandBackground).not.toMatch(/[^a]rgb\(/)
        })

        it('is only faintly tinted at its peak', () => {
            expect(ARRIVAL_BAND_PEAK_ALPHA).toBeGreaterThan(0)
            expect(ARRIVAL_BAND_PEAK_ALPHA).toBeLessThanOrEqual(0.3)
            expect(stops()[1]).toContain(`,${ARRIVAL_BAND_PEAK_ALPHA})`)
        })
    })

    describe('resolveBandWidth', () => {
        it('keeps a readable band on a narrow card', () => {
            expect(resolveBandWidth(40)).toBeGreaterThanOrEqual(72)
        })

        it('scales with the card so the sweep reads as travelling', () => {
            expect(resolveBandWidth(800)).toBeGreaterThan(resolveBandWidth(320))
            expect(resolveBandWidth(800)).toBeLessThan(800)
        })
    })

    it('stops the animation when the card unmounts mid-arrival', () => {
        withAnimationsEnabled(() => {
            const probe = renderMotion()
            probe.arrive(1)
            expect(() => probe.unmount()).not.toThrow()
        })
    })
})
