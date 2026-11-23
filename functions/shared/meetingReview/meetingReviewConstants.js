'use strict'

/**
 * AT-3137 — meeting categories, usefulness rating and time statistics.
 *
 * Two separate dimensions per calendar task (concept artifact I1XDKGUd0ngAg5QStoOB):
 *   - CATEGORY: what kind of appointment it was (a type, suggested by AI/rules, confirmed by the user)
 *   - USEFULNESS: whether the time was worth it for the user (a judgement, ONLY ever set by the user)
 *
 * "Pointless" is deliberately not a category: it is 'not_helpful' in any category. Category keys are
 * stable storage values; the display names live in the translation files.
 *
 * Shared by the app (sheet, chip, statistics) and Cloud Functions (sync suggestion, statistics
 * callable), so the keys can never drift between the two.
 */

const MEETING_CATEGORY_WORK = 'work'
const MEETING_CATEGORY_STAKEHOLDER = 'stakeholder'
const MEETING_CATEGORY_STATUS = 'status'
const MEETING_CATEGORY_NETWORK = 'network'
const MEETING_CATEGORY_OWN_TIME = 'own_time'

// Display order everywhere (sheet, statistics matrix).
const MEETING_CATEGORIES = [
    MEETING_CATEGORY_WORK,
    MEETING_CATEGORY_STAKEHOLDER,
    MEETING_CATEGORY_STATUS,
    MEETING_CATEGORY_NETWORK,
    MEETING_CATEGORY_OWN_TIME,
]

// Translation keys (en/de/es). "Netzwerk & Austausch" was chosen over "Netzwerk & Persönlich"
// (open decision E7, decided 2026-11-23) because "Persönlich" read like private appointments,
// which belong to Eigenzeit.
const MEETING_CATEGORY_LABEL_KEYS = {
    [MEETING_CATEGORY_WORK]: 'Meeting category work',
    [MEETING_CATEGORY_STAKEHOLDER]: 'Meeting category stakeholder',
    [MEETING_CATEGORY_STATUS]: 'Meeting category status',
    [MEETING_CATEGORY_NETWORK]: 'Meeting category network',
    [MEETING_CATEGORY_OWN_TIME]: 'Meeting category own time',
}

const MEETING_CATEGORY_HINT_KEYS = {
    [MEETING_CATEGORY_WORK]: 'Meeting category work hint',
    [MEETING_CATEGORY_STAKEHOLDER]: 'Meeting category stakeholder hint',
    [MEETING_CATEGORY_STATUS]: 'Meeting category status hint',
    [MEETING_CATEGORY_NETWORK]: 'Meeting category network hint',
    [MEETING_CATEGORY_OWN_TIME]: 'Meeting category own time hint',
}

// Accent colors (hex accents read in light and dark mode, see docs/claude/dark-mode.md).
const MEETING_CATEGORY_COLORS = {
    [MEETING_CATEGORY_WORK]: '#0070E0',
    [MEETING_CATEGORY_STAKEHOLDER]: '#8743FF',
    [MEETING_CATEGORY_STATUS]: '#F58E0A',
    [MEETING_CATEGORY_NETWORK]: '#07A873',
    [MEETING_CATEGORY_OWN_TIME]: '#5AACFF',
}

const MEETING_USEFULNESS_WORTHWHILE = 'worthwhile'
const MEETING_USEFULNESS_PARTLY = 'partly'
const MEETING_USEFULNESS_NOT_HELPFUL = 'not_helpful'

const MEETING_USEFULNESS_LEVELS = [
    MEETING_USEFULNESS_WORTHWHILE,
    MEETING_USEFULNESS_PARTLY,
    MEETING_USEFULNESS_NOT_HELPFUL,
]

const MEETING_USEFULNESS_EMOJI = {
    [MEETING_USEFULNESS_WORTHWHILE]: '👍',
    [MEETING_USEFULNESS_PARTLY]: '〰️',
    [MEETING_USEFULNESS_NOT_HELPFUL]: '👎',
}
const MEETING_UNRATED_SYMBOL = '○'

const MEETING_USEFULNESS_LABEL_KEYS = {
    [MEETING_USEFULNESS_WORTHWHILE]: 'Meeting usefulness worthwhile',
    [MEETING_USEFULNESS_PARTLY]: 'Meeting usefulness partly',
    [MEETING_USEFULNESS_NOT_HELPFUL]: 'Meeting usefulness not helpful',
}

// Review status of one occurrence. `skipped` only suppresses asking again; statistically it is
// unrated, exactly like a missing review.
const MEETING_REVIEW_STATUS_RATED = 'rated'
const MEETING_REVIEW_STATUS_SKIPPED = 'skipped'

const MEETING_ATTENDANCE_ATTENDED = 'attended'
const MEETING_ATTENDANCE_NOT_ATTENDED = 'not_attended'

// Where a category came from. Only `user` (and a series default the user set) is CONFIRMED.
const MEETING_CATEGORY_SOURCE_USER = 'user'
const MEETING_CATEGORY_SOURCE_SERIES = 'series'
const MEETING_CATEGORY_SOURCE_RULE = 'rule'
const MEETING_CATEGORY_SOURCE_AI = 'ai'
const MEETING_CATEGORY_SOURCE_HEURISTIC = 'heuristic'

const MEETING_CONFIDENCE_HIGH = 'high'
const MEETING_CONFIDENCE_MEDIUM = 'medium'
const MEETING_CONFIDENCE_LOW = 'low'

// Statistics: below this rated share, the screen says the result is limited (concept 4.1).
const MEETING_RATED_SHARE_WARNING_THRESHOLD = 0.7

// Private, owner-only Firestore locations (users/{uid}/{sub}/{doc} is owner read/write in
// firestore.rules). Project members never see a rating or a category of somebody else's meeting.
const MEETING_REVIEWS_COLLECTION = 'meetingReviews'
const MEETING_SERIES_CATEGORIES_COLLECTION = 'meetingSeriesCategories'
const MEETING_CATEGORY_RULES_COLLECTION = 'meetingCategoryRules'

const isMeetingCategory = value => typeof value === 'string' && MEETING_CATEGORIES.includes(value)
const isMeetingUsefulness = value => typeof value === 'string' && MEETING_USEFULNESS_LEVELS.includes(value)

// Firestore document ids may not contain '/'. Calendar ids from Microsoft can; Google ids cannot,
// so encoding keeps every existing Google id unchanged.
const toMeetingDocId = value => {
    if (typeof value !== 'string' || !value) return ''
    const encoded = value.replace(/%/g, '%25').replace(/\//g, '%2F')
    if (encoded === '.' || encoded === '..') return ''
    return encoded.slice(0, 1400)
}

module.exports = {
    MEETING_CATEGORY_WORK,
    MEETING_CATEGORY_STAKEHOLDER,
    MEETING_CATEGORY_STATUS,
    MEETING_CATEGORY_NETWORK,
    MEETING_CATEGORY_OWN_TIME,
    MEETING_CATEGORIES,
    MEETING_CATEGORY_LABEL_KEYS,
    MEETING_CATEGORY_HINT_KEYS,
    MEETING_CATEGORY_COLORS,
    MEETING_USEFULNESS_WORTHWHILE,
    MEETING_USEFULNESS_PARTLY,
    MEETING_USEFULNESS_NOT_HELPFUL,
    MEETING_USEFULNESS_LEVELS,
    MEETING_USEFULNESS_EMOJI,
    MEETING_UNRATED_SYMBOL,
    MEETING_USEFULNESS_LABEL_KEYS,
    MEETING_REVIEW_STATUS_RATED,
    MEETING_REVIEW_STATUS_SKIPPED,
    MEETING_ATTENDANCE_ATTENDED,
    MEETING_ATTENDANCE_NOT_ATTENDED,
    MEETING_CATEGORY_SOURCE_USER,
    MEETING_CATEGORY_SOURCE_SERIES,
    MEETING_CATEGORY_SOURCE_RULE,
    MEETING_CATEGORY_SOURCE_AI,
    MEETING_CATEGORY_SOURCE_HEURISTIC,
    MEETING_CONFIDENCE_HIGH,
    MEETING_CONFIDENCE_MEDIUM,
    MEETING_CONFIDENCE_LOW,
    MEETING_RATED_SHARE_WARNING_THRESHOLD,
    MEETING_REVIEWS_COLLECTION,
    MEETING_SERIES_CATEGORIES_COLLECTION,
    MEETING_CATEGORY_RULES_COLLECTION,
    isMeetingCategory,
    isMeetingUsefulness,
    toMeetingDocId,
}
