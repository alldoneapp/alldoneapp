/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import PendingAssistantComment from './PendingAssistantComment'
import { LAST_COMMENT_PREVIEW_HEIGHT, PREVIEW_BODY_HEIGHT, PREVIEW_TITLE_HEIGHT } from './lastCommentLayout'
import { PENDING_SEND_AWAITING_REPLY, PENDING_SEND_FAILED, PENDING_SEND_SENDING } from '../assistantLinePendingSend'

// The literal from components/Feeds/Utils/HelperFunctions — inlined rather than imported, because
// that module pulls the redux store and the whole backend graph into this suite.
const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params?.name ? `${key}:${params.name}` : key),
}))

// Driven directly rather than through `window.matchMedia`: react-native-web captures the media
// query list at MODULE LOAD and jsdom has no `matchMedia` then, so its `isReduceMotionEnabled()`
// fails closed to `true` for the whole file — which would make the "spins when motion is allowed"
// case unreachable and the "no spinner on failure" case pass for the wrong reason.
let mockReducedMotion = false
jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => mockReducedMotion,
}))

const pending = (overrides = {}) => ({
    status: PENDING_SEND_SENDING,
    text: 'ship the thing',
    chatId: null,
    ...overrides,
})

// `useReducedMotion` resolves `AccessibilityInfo.isReduceMotionEnabled()` in an effect, so the
// render has to be flushed asynchronously or every case logs an act() warning.
const render = async (props = {}) => {
    let tree
    await act(async () => {
        tree = renderer.create(<PendingAssistantComment pending={pending()} {...props} />)
    })
    return tree
}

const statusOf = tree => tree.root.findByProps({ testID: 'assistant-pending-send-status' }).props.children

describe('PendingAssistantComment (AT-2504)', () => {
    beforeEach(() => {
        mockReducedMotion = false
    })

    it('reserves exactly the height of the real preview so the line never jumps', async () => {
        const tree = await render()
        const card = tree.root.findByProps({ testID: 'assistant-pending-send' })
        const style = StyleSheet.flatten(card.props.style)

        // The whole reason the real preview has a FIXED height is that the assistant line (and
        // everything under it) must not reflow when the last comment changes. A placeholder of a
        // different height would reintroduce that reflow twice per send.
        expect(style.height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)

        const title = tree.root.findByProps({ testID: 'assistant-pending-send-status' })
        const body = tree.root.findByProps({ testID: 'assistant-pending-send-text' })
        expect(title.props.numberOfLines).toBe(1)
        // One clipped title line plus two clipped body lines, same as the real preview.
        expect(body.props.numberOfLines).toBe(2)
        expect(PREVIEW_TITLE_HEIGHT + PREVIEW_BODY_HEIGHT).toBeLessThan(LAST_COMMENT_PREVIEW_HEIGHT)

        act(() => tree.unmount())
    })

    it('echoes the submitted text, because the composer no longer holds it', async () => {
        const tree = await render({ pending: pending({ text: 'ship the thing' }) })
        expect(tree.root.findByProps({ testID: 'assistant-pending-send-text' }).props.children).toBe('ship the thing')
        act(() => tree.unmount())
    })

    it('strips the composer’s serialization rather than showing raw tokens', async () => {
        // A dropped image reaches the composer as a trigger-delimited token wrapping a blob URL
        // (AT-2444). Echoing that verbatim would fill the card with machine text.
        const attachment = `${ATTACHMENT_TRIGGER}blob:http://localhost/9f2${ATTACHMENT_TRIGGER}screenshot.png${ATTACHMENT_TRIGGER}true`
        const tree = await render({ pending: pending({ text: `look at ${attachment} please` }) })
        const text = tree.root.findByProps({ testID: 'assistant-pending-send-text' }).props.children

        expect(text).toBe('look at screenshot.png please')
        expect(text).not.toContain('blob:')
        act(() => tree.unmount())
    })

    it('names the assistant once the wait is on it', async () => {
        const tree = await render({ pending: pending({ status: PENDING_SEND_AWAITING_REPLY }), assistantName: 'Anna' })
        expect(statusOf(tree)).toBe('assistantLineWorkingOnIt:Anna')
        act(() => tree.unmount())
    })

    it('falls back to a nameless line rather than rendering an unresolved placeholder', async () => {
        const tree = await render({ pending: pending({ status: PENDING_SEND_AWAITING_REPLY }) })
        expect(statusOf(tree)).toBe('assistantLineWorkingOnItGeneric')
        act(() => tree.unmount())
    })

    it('says the send is still going out before the topic exists', async () => {
        const tree = await render({ assistantName: 'Anna' })
        expect(statusOf(tree)).toBe('assistantLineSending')
        act(() => tree.unmount())
    })

    it('explains a failure, and drops the spinner that would imply it is still trying', async () => {
        const tree = await render({ pending: pending({ status: PENDING_SEND_FAILED }), assistantName: 'Anna' })

        expect(statusOf(tree)).toBe('assistantLineSendFailed')
        // Motion is deliberately allowed here, so an absent spinner means the failure branch ran —
        // not that the whole suite happened to be in reduced motion.
        expect(mockReducedMotion).toBe(false)
        expect(tree.root.findAllByProps({ testID: 'assistant-pending-send-indicator' }).length).toBe(0)
        expect(tree.root.findAllByProps({ testID: 'assistant-pending-send-static-indicator' }).length).toBe(0)
        act(() => tree.unmount())
    })

    it('renders a pill inside the collapsed row', async () => {
        const tree = await render({ compact: true })
        const card = tree.root.findByProps({ testID: 'assistant-pending-send' })

        // Matches LastAssistantComment's own compact pill so the collapsed row keeps its height.
        expect(StyleSheet.flatten(card.props.style).height).toBe(24)
        act(() => tree.unmount())
    })

    it('announces itself to assistive technology', async () => {
        const tree = await render({ pending: pending({ status: PENDING_SEND_AWAITING_REPLY }), assistantName: 'Anna' })
        const card = tree.root.findByProps({ testID: 'assistant-pending-send' })

        expect(card.props.accessibilityLiveRegion).toBe('polite')
        expect(card.props.accessibilityLabel).toBe('assistantLineWorkingOnIt:Anna')
        act(() => tree.unmount())
    })

    describe('reduced motion', () => {
        it('spins when motion is allowed', async () => {
            mockReducedMotion = false
            const tree = await render()
            expect(tree.root.findAllByProps({ testID: 'assistant-pending-send-indicator' }).length).toBeGreaterThan(0)
            act(() => tree.unmount())
        })

        it('swaps the spinner for a static marker rather than dropping the affordance', async () => {
            mockReducedMotion = true
            const tree = await render()

            expect(tree.root.findAllByProps({ testID: 'assistant-pending-send-indicator' }).length).toBe(0)
            // Still has to read as "in progress" — a bare line of text does not.
            expect(
                tree.root.findAllByProps({ testID: 'assistant-pending-send-static-indicator' }).length
            ).toBeGreaterThan(0)
            act(() => tree.unmount())
        })
    })

    // Same convention as the assistant-line header string: a missing locale silently falls back to
    // English, so parity has to be asserted rather than assumed.
    it('is translated in every supported locale', () => {
        const locales = {
            en: require('../../../../i18n/translations/en.json'),
            de: require('../../../../i18n/translations/de.json'),
            es: require('../../../../i18n/translations/es.json'),
        }

        Object.values(locales).forEach(translations => {
            ;['assistantLineSending', 'assistantLineWorkingOnItGeneric', 'assistantLineSendFailed'].forEach(key => {
                expect(typeof translations[key]).toBe('string')
                expect(translations[key].length).toBeGreaterThan(0)
            })

            // The one interpolated string: a locale that drops `%{name}` renders the assistant's
            // name nowhere, which is the whole point of that line.
            expect(translations['assistantLineWorkingOnIt']).toContain('%{name}')
        })
    })
})
