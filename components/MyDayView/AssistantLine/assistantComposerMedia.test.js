/**
 * AT-2444 — the assistant line accepts dropped/pasted files, so it has to be able to tell a
 * composer that is holding one from a composer that is holding prose.
 *
 * Deliberately driven with REAL trigger tokens built the way `CustomTextInput3.updateText`
 * serializes them, not with a stubbed regex: the point of the helper is that it reads the same
 * text `updateNewAttachmentsData` uploads from and `extractMediaContextFromText` builds the
 * assistant's media context from, and a hand-written fixture that only resembles a token would
 * pass while the real thing failed.
 */
import {
    ASSISTANT_INPUT_MEDIA_MAX_HEIGHT,
    assistantComposerHasMedia,
    getAssistantComposerMaxHeight,
} from './assistantComposerMedia'
import { ASSISTANT_INPUT_MAX_HEIGHT } from './assistantInputLayout'

const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'

const imageToken = (name = 'shot.png') =>
    `${IMAGE_TRIGGER}https://x/full.png${IMAGE_TRIGGER}https://x/small.png${IMAGE_TRIGGER}${name}${IMAGE_TRIGGER}1`
const attachmentToken = (name = 'report.pdf') =>
    `${ATTACHMENT_TRIGGER}https://x/report.pdf${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}1`
const videoToken = (name = 'clip.mp4') => `${VIDEO_TRIGGER}https://x/clip.mp4${VIDEO_TRIGGER}${name}${VIDEO_TRIGGER}1`

describe('assistantComposerHasMedia', () => {
    it('is false for prose, an empty composer and non-string input', () => {
        expect(assistantComposerHasMedia('Summarise my open tasks please')).toBe(false)
        expect(assistantComposerHasMedia('')).toBe(false)
        expect(assistantComposerHasMedia(undefined)).toBe(false)
        expect(assistantComposerHasMedia(null)).toBe(false)
        expect(assistantComposerHasMedia(42)).toBe(false)
    })

    it('recognises an image, a file and a video embed', () => {
        expect(assistantComposerHasMedia(imageToken())).toBe(true)
        expect(assistantComposerHasMedia(attachmentToken())).toBe(true)
        expect(assistantComposerHasMedia(videoToken())).toBe(true)
    })

    it('finds a token that is not the first word — the regexes are anchored, so it must split', () => {
        expect(assistantComposerHasMedia(`What is on this? ${imageToken()}`)).toBe(true)
        expect(assistantComposerHasMedia(`${imageToken()} what is on this?`)).toBe(true)
    })

    it('finds a token separated by the newlines a multi-line composer produces', () => {
        expect(assistantComposerHasMedia(`line one\n${imageToken()}\nline two`)).toBe(true)
    })

    it('does not fire on prose that merely mentions an image', () => {
        expect(assistantComposerHasMedia('Please look at the image I sent you earlier')).toBe(false)
        // A bare trigger string with none of the token's fields is not an embed.
        expect(assistantComposerHasMedia(IMAGE_TRIGGER)).toBe(false)
    })
})

describe('getAssistantComposerMaxHeight', () => {
    it('keeps the text cap when the composer holds no media', () => {
        expect(getAssistantComposerMaxHeight(false)).toBe(ASSISTANT_INPUT_MAX_HEIGHT)
    })

    it('raises the cap for media so a 200px image preview is not clipped into a scroller', () => {
        expect(getAssistantComposerMaxHeight(true)).toBe(ASSISTANT_INPUT_MEDIA_MAX_HEIGHT)
        expect(ASSISTANT_INPUT_MEDIA_MAX_HEIGHT).toBeGreaterThan(ASSISTANT_INPUT_MAX_HEIGHT)
    })
})
