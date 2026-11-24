'use strict'

/**
 * AT-3137 — which category the sheet proposes for a calendar task, how sure it is, and why.
 *
 * Priority (concept 3.4, highest first):
 *   1. the category the user set for THIS occurrence (confirmed)
 *   2. the series default the user set for its recurring series
 *   3. a learned rule from the user's own corrections (same title pattern), visible and deletable
 *   4. the unambiguous rule "no other participants → own time", except that a clear learning title
 *      (webinar, training, insight session …) proposes "learning" instead (AT-3147: such sessions
 *      often arrive as a private copy without participants)
 *   5. the AI suggestion written by the existing calendar routing LLM run (no extra call)
 *   6. keyword signals in the title/description, combined with the participant structure
 *
 * Hard rules (concept 3.2):
 *   - nothing here ever proposes a USEFULNESS. The usefulness of every occurrence is the user's
 *     judgement alone and is never derived from category, series, history or title.
 *   - only real calendar fields are used; a missing field lowers the confidence, it is never
 *     guessed. Signals shown under "Why?" name the fields that were actually present.
 *   - low confidence preselects nothing; the two most likely categories are only highlighted.
 *
 * Only a category the USER chose (or confirmed with a rating) is "confirmed". Everything else is a
 * suggestion and is counted as "category open" in the statistics (decision E1).
 */

const {
    MEETING_CATEGORY_WORK,
    MEETING_CATEGORY_STATUS,
    MEETING_CATEGORY_LEARNING,
    MEETING_CATEGORY_NETWORK,
    MEETING_CATEGORY_OWN_TIME,
    MEETING_CATEGORIES,
    MEETING_CATEGORY_SOURCE_USER,
    MEETING_CATEGORY_SOURCE_SERIES,
    MEETING_CATEGORY_SOURCE_RULE,
    MEETING_CATEGORY_SOURCE_AI,
    MEETING_CATEGORY_SOURCE_HEURISTIC,
    MEETING_CONFIDENCE_HIGH,
    MEETING_CONFIDENCE_MEDIUM,
    MEETING_CONFIDENCE_LOW,
    MEETING_REVIEW_STATUS_RATED,
    MEETING_REVIEW_STATUS_SKIPPED,
    MEETING_ATTENDANCE_ATTENDED,
    MEETING_ATTENDANCE_NOT_ATTENDED,
    isMeetingCategory,
    normalizeMeetingCategory,
    isMeetingUsefulness,
} = require('./meetingReviewConstants')
const { getCalendarEventBounds } = require('./calendarEventCounting')

// Whole words / phrases, matched case-insensitively on word boundaries. German and English, the
// two languages calendars in this product are written in. Kept short on purpose: a keyword alone
// never yields more than "medium".
//
// AT-3147: "Status & Stakeholder" holds the words of both former categories. "Learning" holds the
// learning formats that used to count as network (webinar, talk); "Network & sales" gained the sales
// words. A longer phrase beats a shorter word of another category that it contains ("insight
// session" is learning, not the "session" of a working meeting), see findKeywordMatches.
const CATEGORY_KEYWORDS = {
    [MEETING_CATEGORY_STATUS]: [
        'standup',
        'stand-up',
        'daily',
        'jour fixe',
        'jourfixe',
        'weekly',
        'sync',
        'update',
        'status',
        'reporting',
        'round-up',
        'roundup',
        'all hands',
        'allhands',
        'all-hands',
        'townhall',
        'town hall',
        'retro',
        'check-in',
        'checkin',
        'steering',
        'steerco',
        'freigabe',
        'approval',
        'board',
        'beirat',
        'investor',
        'abstimmung',
        'alignment',
        'review mit',
        'kundentermin',
        'kunde',
        'customer',
        'client',
        'qbr',
    ],
    [MEETING_CATEGORY_WORK]: [
        'workshop',
        'session',
        'planning',
        'deep dive',
        'deep-dive',
        'deepdive',
        'brainstorm',
        'brainstorming',
        'pairing',
        'co-creation',
        'konzept',
        'design',
        'architektur',
        'architecture',
        'refinement',
        'arbeitssession',
        'working session',
    ],
    [MEETING_CATEGORY_LEARNING]: [
        'insight session',
        'insights session',
        'learning session',
        'lernsession',
        'knowledge sharing',
        'knowledge session',
        'wissensaustausch',
        'wissenstransfer',
        'webinar',
        'training',
        'schulung',
        'fortbildung',
        'weiterbildung',
        'seminar',
        'masterclass',
        'tutorial',
        'lecture',
        'vortrag',
        'talk',
        'tech talk',
        'brown bag',
        'brownbag',
        'lunch & learn',
        'lunch and learn',
        'show & tell',
        'show and tell',
    ],
    [MEETING_CATEGORY_NETWORK]: [
        'intro',
        'kennenlernen',
        'coffee',
        'kaffee',
        'networking',
        'mentoring',
        'mentor',
        'konferenz',
        'conference',
        'meetup',
        'interview',
        'bewerbungsgespräch',
        'chat',
        'sales',
        'vertrieb',
        'akquise',
        'pitch',
        'prospect',
        'discovery call',
    ],
    [MEETING_CATEGORY_OWN_TIME]: [
        'fokus',
        'focus',
        'fokuszeit',
        'focus time',
        'block',
        'blocker',
        'deep work',
        'vorbereitung',
        'prep',
        'mittag',
        'lunch',
        'mittagessen',
        'arzt',
        'kita',
        'sport',
        'gym',
        'familie',
        'family',
        'pendeln',
        'commute',
        'reise',
    ],
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const KEYWORD_MATCHERS = Object.entries(CATEGORY_KEYWORDS).map(([category, words]) => ({
    category,
    matchers: words
        .slice()
        .sort((a, b) => b.length - a.length)
        .map(word => ({
            word,
            regex: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'iu'),
        })),
}))

/**
 * "Jour fixe 24.11. – Team" → "jour fixe team". Digits, dates and punctuation are dropped so the
 * weekly occurrences of a meeting share one pattern.
 */
const normalizeMeetingTitlePattern = title =>
    String(title || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{N}]+/gu, ' ')
        .replace(/[^\p{L}\s&]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)

const MIN_RULE_PATTERN_LENGTH = 3

const isUsableRulePattern = pattern => typeof pattern === 'string' && pattern.length >= MIN_RULE_PATTERN_LENGTH

const signal = (key, params = {}) => ({ key, params })

const containsWord = (phrase, word) =>
    phrase !== word && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(phrase)

const findKeywordMatches = text => {
    const matches = []
    KEYWORD_MATCHERS.forEach(({ category, matchers }) => {
        const hit = matchers.find(({ regex }) => regex.test(text))
        if (hit) matches.push({ category, word: hit.word })
    })
    // "AI Insight Session" hits learning ("insight session") and work ("session"); the longer phrase
    // is the more specific signal, so the word it contains is not counted as a second category.
    return matches.filter(
        match => !matches.some(other => other.category !== match.category && containsWord(other.word, match.word))
    )
}

const getAttendeeCount = calendarData =>
    typeof calendarData?.attendeeCount === 'number' && Number.isFinite(calendarData.attendeeCount)
        ? calendarData.attendeeCount
        : null

const getExternalAttendeeCount = calendarData =>
    typeof calendarData?.externalAttendeeCount === 'number' && Number.isFinite(calendarData.externalAttendeeCount)
        ? calendarData.externalAttendeeCount
        : null

/**
 * The rule- and keyword-based suggestion, from real calendar fields only.
 * @returns {{category:string|null, confidence:string, candidates:string[], signals:Array}}
 */
const getHeuristicCategorySuggestion = task => {
    const calendarData = task?.calendarData || {}
    const attendeeCount = getAttendeeCount(calendarData)
    const externalCount = getExternalAttendeeCount(calendarData)
    const isRecurring = !!calendarData.recurringEventId
    const baseSignals = []
    if (isRecurring) baseSignals.push(signal('Meeting signal recurring'))
    if (attendeeCount !== null && attendeeCount > 0) {
        baseSignals.push(signal('Meeting signal attendees', { count: attendeeCount }))
        if (externalCount) baseSignals.push(signal('Meeting signal external attendees', { count: externalCount }))
    }

    const title = String(task?.name || task?.extendedName || '')
    const titleMatches = findKeywordMatches(title)

    if (attendeeCount === 0) {
        // AT-3147: a learning session (webinar, training, "AI Insight Session") often has no
        // participants in the user's copy of the event (registration, private mirror block). A clear
        // learning title then proposes learning, with medium confidence, instead of own time.
        const learning = titleMatches.length === 1 && titleMatches[0].category === MEETING_CATEGORY_LEARNING
        if (learning) {
            return {
                category: MEETING_CATEGORY_LEARNING,
                confidence: MEETING_CONFIDENCE_MEDIUM,
                candidates: [MEETING_CATEGORY_LEARNING, MEETING_CATEGORY_OWN_TIME],
                signals: [
                    signal('Meeting signal title word', { word: titleMatches[0].word }),
                    signal('Meeting signal no attendees'),
                    ...baseSignals,
                ],
                // Takes the place of the own-time rule, so it ranks above an AI suggestion.
                decisive: true,
            }
        }
        return {
            category: MEETING_CATEGORY_OWN_TIME,
            confidence: MEETING_CONFIDENCE_HIGH,
            candidates: [MEETING_CATEGORY_OWN_TIME],
            signals: [signal('Meeting signal no attendees'), ...baseSignals],
        }
    }

    const descriptionMatches = titleMatches.length === 0 ? findKeywordMatches(String(task?.description || '')) : []
    const matches = titleMatches.length > 0 ? titleMatches : descriptionMatches
    const matchSignal = match =>
        signal(titleMatches.length > 0 ? 'Meeting signal title word' : 'Meeting signal description word', {
            word: match.word,
        })

    // A keyword for own time next to other participants contradicts itself ("Lunch with the
    // board"); drop it rather than claim own time.
    const consistentMatches = matches.filter(
        match => !(match.category === MEETING_CATEGORY_OWN_TIME && attendeeCount !== null && attendeeCount > 0)
    )

    if (consistentMatches.length === 1) {
        const [match] = consistentMatches
        // A learning title fits without a participant list (webinars rarely carry one).
        const structureFits =
            (attendeeCount !== null && attendeeCount > 0) ||
            (isRecurring && match.category === MEETING_CATEGORY_STATUS) ||
            (titleMatches.length > 0 && match.category === MEETING_CATEGORY_LEARNING)
        return {
            category: structureFits ? match.category : null,
            confidence: structureFits ? MEETING_CONFIDENCE_MEDIUM : MEETING_CONFIDENCE_LOW,
            candidates: [match.category],
            signals: [matchSignal(match), ...baseSignals],
        }
    }

    if (consistentMatches.length > 1) {
        // Prefer the precedence rule of the concept (what happens beats who is there): status &
        // stakeholder, then work, then learning, then network & sales.
        const order = [
            MEETING_CATEGORY_OWN_TIME,
            MEETING_CATEGORY_STATUS,
            MEETING_CATEGORY_WORK,
            MEETING_CATEGORY_LEARNING,
            MEETING_CATEGORY_NETWORK,
        ]
        const sorted = consistentMatches.slice().sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
        return {
            category: null,
            confidence: MEETING_CONFIDENCE_LOW,
            candidates: sorted.slice(0, 2).map(match => match.category),
            signals: [...sorted.slice(0, 2).map(matchSignal), ...baseSignals],
        }
    }

    return {
        category: null,
        confidence: MEETING_CONFIDENCE_LOW,
        candidates: externalCount ? [MEETING_CATEGORY_STATUS] : [],
        signals: baseSignals.length > 0 ? baseSignals : [signal('Meeting signal thin data')],
    }
}

const findMatchingRule = (task, rules = []) => {
    const pattern = normalizeMeetingTitlePattern(task?.name || task?.extendedName)
    if (!isUsableRulePattern(pattern)) return null
    const rule =
        (Array.isArray(rules) ? rules : []).find(
            rule => rule && rule.pattern === pattern && normalizeMeetingCategory(rule.category)
        ) || null
    return rule ? { ...rule, category: normalizeMeetingCategory(rule.category) } : null
}

const normalizeAiSuggestion = aiSuggestion => {
    const category = normalizeMeetingCategory(aiSuggestion?.category)
    if (!category) return null
    const confidence =
        aiSuggestion.confidence === MEETING_CONFIDENCE_MEDIUM ? MEETING_CONFIDENCE_MEDIUM : MEETING_CONFIDENCE_LOW
    const texts = (Array.isArray(aiSuggestion.signals) ? aiSuggestion.signals : [])
        .filter(text => typeof text === 'string' && text.trim())
        .slice(0, 3)
    return { category, confidence, texts }
}

/**
 * The category state of one occurrence, as the sheet and the statistics see it.
 *
 * @param {object} params
 * @param {object} params.task calendar task ({ name, description, calendarData })
 * @param {object|null} params.review users/{uid}/meetingReviews/{taskId}
 * @param {string|null} params.seriesCategory users/{uid}/meetingSeriesCategories/{seriesId}.category
 * @param {Array} params.rules users/{uid}/meetingCategoryRules
 * @returns {{category:string|null, confirmed:boolean, source:string|null, confidence:string|null,
 *            preselected:boolean, candidates:string[], signals:Array}}
 */
const resolveMeetingCategory = ({ task, review = null, seriesCategory: storedSeriesCategory = null, rules = [] }) => {
    // Stored values may still carry a retired key ('stakeholder' → 'status', AT-3147).
    const reviewCategory = normalizeMeetingCategory(review?.category)
    const seriesCategory = normalizeMeetingCategory(storedSeriesCategory)
    if (review && review.categorySource === MEETING_CATEGORY_SOURCE_USER && reviewCategory) {
        return {
            category: reviewCategory,
            confirmed: true,
            source: MEETING_CATEGORY_SOURCE_USER,
            confidence: MEETING_CONFIDENCE_HIGH,
            preselected: true,
            candidates: [reviewCategory],
            signals: [signal('Meeting signal confirmed by you')],
        }
    }

    const unconfirmed = (category, source, confidence, signals, candidates = [category]) => ({
        category: confidence === MEETING_CONFIDENCE_LOW ? null : category,
        confirmed: false,
        source,
        confidence,
        preselected: confidence !== MEETING_CONFIDENCE_LOW && !!category,
        candidates,
        signals,
    })

    if (seriesCategory) {
        return unconfirmed(seriesCategory, MEETING_CATEGORY_SOURCE_SERIES, MEETING_CONFIDENCE_HIGH, [
            signal('Meeting signal series default'),
        ])
    }

    const rule = findMatchingRule(task, rules)
    if (rule) {
        const corrections = Number(rule.corrections) || 1
        return unconfirmed(
            rule.category,
            MEETING_CATEGORY_SOURCE_RULE,
            corrections >= 2 ? MEETING_CONFIDENCE_HIGH : MEETING_CONFIDENCE_MEDIUM,
            [signal('Meeting signal learned rule', { pattern: rule.pattern, count: corrections })]
        )
    }

    const heuristic = getHeuristicCategorySuggestion(task)
    if (heuristic.confidence === MEETING_CONFIDENCE_HIGH || heuristic.decisive) {
        return unconfirmed(
            heuristic.category,
            MEETING_CATEGORY_SOURCE_HEURISTIC,
            heuristic.confidence,
            heuristic.signals
        )
    }

    const ai = normalizeAiSuggestion(review?.aiSuggestion)
    if (ai) {
        const candidates = [ai.category, ...heuristic.candidates.filter(category => category !== ai.category)].slice(
            0,
            2
        )
        return unconfirmed(
            ai.category,
            MEETING_CATEGORY_SOURCE_AI,
            ai.confidence,
            [...ai.texts.map(text => signal('Meeting signal ai text', { text })), ...heuristic.signals.slice(0, 2)],
            candidates
        )
    }

    return {
        category: heuristic.category,
        confirmed: false,
        source: heuristic.category || heuristic.candidates.length > 0 ? MEETING_CATEGORY_SOURCE_HEURISTIC : null,
        confidence: heuristic.confidence,
        preselected: !!heuristic.category && heuristic.confidence !== MEETING_CONFIDENCE_LOW,
        candidates: heuristic.candidates,
        signals: heuristic.signals,
    }
}

/**
 * Default of "Applies to: series from now / only this occurrence" (concept 2.4): the series when it
 * has no default yet, otherwise only this occurrence (an exception). null when not a series.
 */
const getDefaultSeriesScope = ({ recurringEventId, seriesCategory }) => {
    if (!recurringEventId) return null
    return normalizeMeetingCategory(seriesCategory) ? 'instance' : 'series'
}

/**
 * The fields to merge into users/{uid}/meetingReviews/{taskId} for one user action.
 *
 * @param {object} params
 * @param {object} params.task calendar task
 * @param {object} params.resolved result of resolveMeetingCategory for the task
 * @param {object} params.action one of
 *   { type: 'rate', usefulness, category? }      usefulness tap (confirms a preselected category)
 *   { type: 'category', category }                category chosen without rating
 *   { type: 'skip' }                              "Later" / dismiss
 *   { type: 'clear' }                             "Remove rating" → unrated again
 *   { type: 'not_attended' }                      0 minutes, no usefulness question
 *   { type: 'attended' }                          undo "not attended"
 *   { type: 'duration', actualStartMs, actualEndMs }  null/null = as planned
 * @param {object|null} params.existing the stored review, if any
 * @param {number} params.nowMs
 */
const buildMeetingReviewUpdate = ({ task, resolved, action, existing = null, nowMs = Date.now() }) => {
    const bounds = getCalendarEventBounds(task?.calendarData) || {}
    const update = {
        taskId: task?.id || existing?.taskId || '',
        projectId: task?.projectId || existing?.projectId || '',
        recurringEventId: task?.calendarData?.recurringEventId || null,
        startMs: Number.isFinite(bounds.startMs) ? bounds.startMs : (existing?.startMs ?? null),
        endMs: Number.isFinite(bounds.endMs) ? bounds.endMs : (existing?.endMs ?? null),
        updatedAt: nowMs,
    }

    const confirmCategory = (category, confirmedFrom) => {
        update.category = category
        update.categorySource = MEETING_CATEGORY_SOURCE_USER
        update.categoryConfirmedAt = nowMs
        update.categoryConfirmedFrom = confirmedFrom || MEETING_CATEGORY_SOURCE_USER
    }

    switch (action?.type) {
        case 'rate': {
            if (!isMeetingUsefulness(action.usefulness)) throw new Error('Invalid meeting usefulness')
            update.usefulness = action.usefulness
            update.reviewStatus = MEETING_REVIEW_STATUS_RATED
            update.ratedAt = nowMs
            update.attendance = MEETING_ATTENDANCE_ATTENDED
            if (isMeetingCategory(action.category)) {
                const fromSuggestion = resolved?.preselected && resolved.category === action.category
                confirmCategory(action.category, fromSuggestion ? resolved.source : MEETING_CATEGORY_SOURCE_USER)
            } else if (resolved?.confirmed && isMeetingCategory(resolved.category)) {
                // already confirmed, nothing to change
            } else if (resolved?.preselected && isMeetingCategory(resolved.category)) {
                confirmCategory(resolved.category, resolved.source)
            }
            break
        }
        case 'category':
            if (!isMeetingCategory(action.category)) throw new Error('Invalid meeting category')
            confirmCategory(action.category, MEETING_CATEGORY_SOURCE_USER)
            break
        case 'skip':
            if (existing?.reviewStatus !== MEETING_REVIEW_STATUS_RATED)
                update.reviewStatus = MEETING_REVIEW_STATUS_SKIPPED
            break
        case 'clear':
            update.usefulness = null
            update.reviewStatus = null
            update.ratedAt = null
            break
        case 'not_attended':
            update.attendance = MEETING_ATTENDANCE_NOT_ATTENDED
            update.usefulness = null
            update.reviewStatus = null
            update.ratedAt = null
            break
        case 'attended':
            update.attendance = MEETING_ATTENDANCE_ATTENDED
            break
        case 'duration': {
            const { actualStartMs, actualEndMs } = action
            const valid = Number.isFinite(actualStartMs) && Number.isFinite(actualEndMs) && actualEndMs > actualStartMs
            const asPlanned = !valid || (actualStartMs === update.startMs && actualEndMs === update.endMs)
            update.actualStartMs = asPlanned ? null : actualStartMs
            update.actualEndMs = asPlanned ? null : actualEndMs
            update.attendance = MEETING_ATTENDANCE_ATTENDED
            break
        }
        default:
            throw new Error('Unknown meeting review action')
    }
    return update
}

/**
 * When the user corrects the proposal for a single (non-series) occurrence, remember it as a
 * visible, deletable rule keyed by the title pattern (concept 3.4). Returns null when nothing should
 * be learned: the proposal was right, the title has no usable pattern, or the change is a series
 * default (that is stored on the series instead).
 */
const buildCategoryRuleUpdate = ({
    task,
    resolved,
    chosenCategory,
    scope,
    existingRule = null,
    nowMs = Date.now(),
}) => {
    if (!isMeetingCategory(chosenCategory) || scope === 'series') return null
    if (resolved?.preselected && resolved.category === chosenCategory) return null
    if (resolved?.confirmed && resolved.category === chosenCategory) return null
    const pattern = normalizeMeetingTitlePattern(task?.name || task?.extendedName)
    if (!isUsableRulePattern(pattern)) return null
    const sameCategory = existingRule && normalizeMeetingCategory(existingRule.category) === chosenCategory
    return {
        pattern,
        category: chosenCategory,
        corrections: sameCategory ? (Number(existingRule.corrections) || 0) + 1 : 1,
        updatedAt: nowMs,
    }
}

/**
 * Converts the routing classifier's 0..1 number into the levels the sheet shows. A general AI
 * estimate is never "high" (concept 3.3: high is reserved for series defaults, the user's own
 * corrections and unambiguous rules).
 */
const toAiConfidenceLevel = value =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0.6
        ? MEETING_CONFIDENCE_MEDIUM
        : MEETING_CONFIDENCE_LOW

module.exports = {
    CATEGORY_KEYWORDS,
    MEETING_CATEGORIES,
    normalizeMeetingTitlePattern,
    isUsableRulePattern,
    getHeuristicCategorySuggestion,
    resolveMeetingCategory,
    getDefaultSeriesScope,
    buildMeetingReviewUpdate,
    buildCategoryRuleUpdate,
    toAiConfidenceLevel,
}
