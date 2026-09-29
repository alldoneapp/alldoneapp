import {
    __resetThinkingAnimationChoiceForTests,
    acquireThinkingAnimation,
    releaseThinkingAnimation,
    THINKING_ANIMATION_HANDOFF_MS,
    THINKING_ANIMATIONS,
} from './thinkingAnimationChoice'

describe('thinking animation choice', () => {
    beforeEach(() => __resetThinkingAnimationChoiceForTests())

    test('never plays the same scene twice in a row', () => {
        let previous = null
        for (let i = 0; i < 200; i++) {
            const picked = acquireThinkingAnimation({ now: i * 10000, random: () => (i * 0.37) % 1 })
            expect(THINKING_ANIMATIONS).toContain(picked)
            expect(picked).not.toBe(previous)
            previous = picked
        }
    })

    test('reaches every scene', () => {
        const seen = new Set()
        for (let i = 0; i < 400; i++) seen.add(acquireThinkingAnimation({ now: i * 10000, random: Math.random }))
        expect(seen.size).toBe(THINKING_ANIMATIONS.length)
    })

    test('a card that takes over a run right away keeps its scene (placeholder → message)', () => {
        const placeholder = acquireThinkingAnimation({ now: 1000, random: () => 0.5 })
        releaseThinkingAnimation(placeholder, 2000)
        expect(acquireThinkingAnimation({ now: 2000 + THINKING_ANIMATION_HANDOFF_MS, random: () => 0 })).toBe(
            placeholder
        )
    })

    test('a later run picks a new scene, and a handed-over scene is only reused once', () => {
        const first = acquireThinkingAnimation({ now: 0, random: () => 0.5 })
        releaseThinkingAnimation(first, 100)
        expect(acquireThinkingAnimation({ now: 100 + THINKING_ANIMATION_HANDOFF_MS + 1, random: () => 0.5 })).not.toBe(
            first
        )

        const second = acquireThinkingAnimation({ now: 50000, random: () => 0.1 })
        releaseThinkingAnimation(second, 50000)
        expect(acquireThinkingAnimation({ now: 50001, random: () => 0.9 })).toBe(second)
        expect(acquireThinkingAnimation({ now: 50002, random: () => 0.9 })).not.toBe(second)
    })
})
