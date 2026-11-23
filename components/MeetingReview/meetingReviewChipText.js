import { translate } from '../../i18n/TranslationService'
import {
    MEETING_ATTENDANCE_NOT_ATTENDED,
    MEETING_CATEGORY_LABEL_KEYS,
    MEETING_REVIEW_STATUS_RATED,
    MEETING_UNRATED_SYMBOL,
    MEETING_USEFULNESS_EMOJI,
    isMeetingCategory,
    isMeetingUsefulness,
} from '../../functions/shared/meetingReview/meetingReviewConstants'

/**
 * AT-3137 — the chip text (concept 5.1):
 *   [Status & Routine · 👎]    rated, category confirmed
 *   [Status & Routine? · ○]    unrated, category only a suggestion
 *   [Category? · ○]            category open
 *   [not attended]
 */
export const getMeetingReviewChipState = (review, resolved) => {
    if (review?.attendance === MEETING_ATTENDANCE_NOT_ATTENDED) return { notAttended: true }
    const rated = review?.reviewStatus === MEETING_REVIEW_STATUS_RATED && isMeetingUsefulness(review?.usefulness)
    const category = isMeetingCategory(resolved?.category) ? resolved.category : null
    return {
        notAttended: false,
        category,
        categoryConfirmed: !!resolved?.confirmed && !!category,
        usefulness: rated ? review.usefulness : null,
    }
}

export const getMeetingReviewChipText = (review, resolved) => {
    const chip = getMeetingReviewChipState(review, resolved)
    if (chip.notAttended) return translate('Meeting not attended short')
    const categoryText = chip.category
        ? `${translate(MEETING_CATEGORY_LABEL_KEYS[chip.category])}${chip.categoryConfirmed ? '' : '?'}`
        : translate('Meeting category open short')
    const usefulnessText = chip.usefulness ? MEETING_USEFULNESS_EMOJI[chip.usefulness] : MEETING_UNRATED_SYMBOL
    return `${categoryText} · ${usefulnessText}`
}
