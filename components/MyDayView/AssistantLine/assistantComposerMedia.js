import { REGEX_ATTACHMENT, REGEX_IMAGE, REGEX_VIDEO } from '../../../functions/Utils/parseTextUtils'

import { ASSISTANT_INPUT_MAX_HEIGHT } from './assistantInputLayout'

/**
 * The assistant line's composer is capped at ASSISTANT_INPUT_MAX_HEIGHT (120px), which is right
 * for text and wrong for an attachment (AT-2444): `CustomImage` renders a dropped image at 200px
 * on desktop, so a 120px viewport would show the top half of it inside a scroller — the user
 * cannot tell what they attached without scrolling a field they are trying to type into.
 *
 * Growing the cap only while the composer actually holds media keeps the resting geometry of the
 * line byte-identical: a text-only composer never sees this number.
 */
export const ASSISTANT_INPUT_MEDIA_MAX_HEIGHT = 260

/**
 * Does the serialized composer text carry an attachment / image / video embed?
 *
 * `CustomTextInput3.updateText` serializes those three embeds as space-delimited trigger tokens
 * (see `components/Feeds/Utils/HelperFunctions.js`), so testing the words is exactly how
 * `updateNewAttachmentsData` and `extractMediaContextFromText` read the same text. The regexes are
 * anchored at `^`, which is why this has to split on whitespace rather than test the whole string.
 */
export const assistantComposerHasMedia = text => {
    if (!text || typeof text !== 'string') return false

    return text
        .split(/\s+/)
        .some(word => !!word && (REGEX_ATTACHMENT.test(word) || REGEX_IMAGE.test(word) || REGEX_VIDEO.test(word)))
}

export const getAssistantComposerMaxHeight = hasMedia =>
    hasMedia ? ASSISTANT_INPUT_MEDIA_MAX_HEIGHT : ASSISTANT_INPUT_MAX_HEIGHT
