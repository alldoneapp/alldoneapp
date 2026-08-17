'use strict'

const admin = require('firebase-admin')
const crypto = require('crypto')
const moment = require('moment-timezone')

const { getEnvFunctions } = require('../envFunctionsHelper')
const {
    createCalendarEventForAssistantRequest,
    findCalendarAvailabilityForAssistantRequest,
} = require('../GoogleCalendar/assistantCalendarTools')
const {
    DEFAULT_PUBLIC_EMAIL,
    buildDailyEmailParticipantEmails,
    getEmailParticipantDisplayName,
    normalizeEmailAddress,
    normalizeSafeEmailActionContext,
    splitQuotedReplyText,
    stripHtmlToText,
} = require('./emailChannelHelpers')
const { sendAnnaEmailReply } = require('./emailReplyService')

const GUEST_MEETING_GRANT_COLLECTION = 'annaEmailGuestMeetingGrants'
const MAX_GRANT_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000

function normalizeThreadMessageId(value = '') {
    const normalized = String(value || '').trim()
    if (!normalized) return ''
    const angleMatch = normalized.match(/^<([^>]+)>$/)
    return String(angleMatch?.[1] || normalized)
        .trim()
        .toLowerCase()
}

function extractThreadMessageIds(...values) {
    const ids = []
    values.forEach(value => {
        const normalized = String(value || '').trim()
        if (!normalized) return

        const angleMatches = Array.from(normalized.matchAll(/<([^>]+)>/g)).map(match => match[1])
        const candidates = angleMatches.length > 0 ? angleMatches : normalized.split(/\s+/)
        candidates.forEach(candidate => {
            const messageId = normalizeThreadMessageId(candidate)
            if (messageId && !ids.includes(messageId)) ids.push(messageId)
        })
    })
    return ids
}

function buildGuestMeetingGrantId(outboundMessageId = '') {
    const normalizedMessageId = normalizeThreadMessageId(outboundMessageId)
    if (!normalizedMessageId) return ''
    return crypto.createHash('sha256').update(normalizedMessageId).digest('hex')
}

function buildMeetingSummary(subject = '', ownerName = '', guestEmail = '') {
    const normalizedSubject = String(subject || '')
        .replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 160)
    if (normalizedSubject) return normalizedSubject

    const guestName = getEmailParticipantDisplayName(guestEmail) || 'Guest'
    return [String(ownerName || '').trim(), guestName].filter(Boolean).join(' / ') || 'Meeting'
}

function isGuestMeetingProposalRequest(value = '') {
    const rawText = String(value || '')
    const currentText = splitQuotedReplyText(/<[^>]+>/.test(rawText) ? stripHtmlToText(rawText) : rawText).newText
    const text = normalizeSelectionText(currentText)
    if (!text) return false

    const mentionsMeetingOptions =
        /\b(?:termin|termine|zeit|zeiten|slot|slots|time|times|date|dates|appointment|appointments|availability)\b/.test(
            text
        )
    const asksToShareOptions = [
        /\b(?:vorschlag|vorschlage|vorschlagen|schlag|schlage)\b/,
        /\b(?:propose|suggest|offer|share|send)\b/,
    ].some(pattern => pattern.test(text))
    return mentionsMeetingOptions && asksToShareOptions
}

function getGrantExpiration(safeActionContext, createdAt = Date.now()) {
    const latestOptionStart = Math.max(
        ...safeActionContext.options.map(option => Date.parse(option.start)).filter(Number.isFinite)
    )
    if (!Number.isFinite(latestOptionStart) || latestOptionStart <= createdAt) return null
    return Math.min(createdAt + MAX_GRANT_LIFETIME_MS, latestOptionStart)
}

async function maybeCreateGuestMeetingGrant({
    ownerUserId,
    projectId,
    assistantId,
    ownerEmail,
    ownerName,
    language,
    subject,
    ownerRequestText,
    inboundMessageId,
    outboundMessageId,
    recipientEmails = [],
    safeActionContext,
    canCreateCalendarEvent = false,
    now = Date.now(),
} = {}) {
    if (canCreateCalendarEvent !== true) return { created: false, reason: 'calendar_create_not_allowed' }
    if (!isGuestMeetingProposalRequest(ownerRequestText)) {
        return { created: false, reason: 'owner_did_not_authorize_guest_options' }
    }

    const normalizedContext = normalizeSafeEmailActionContext(safeActionContext)
    if (!normalizedContext) return { created: false, reason: 'missing_availability_context' }

    const normalizedOwnerEmail = normalizeEmailAddress(ownerEmail)
    const participants = buildDailyEmailParticipantEmails([normalizedOwnerEmail, ...recipientEmails])
    const guestEmails = participants.filter(email => email !== normalizedOwnerEmail)
    if (!normalizedOwnerEmail || guestEmails.length !== 1) {
        return { created: false, reason: 'requires_exactly_one_guest' }
    }

    const normalizedOutboundMessageId = normalizeThreadMessageId(outboundMessageId)
    const grantId = buildGuestMeetingGrantId(normalizedOutboundMessageId)
    if (!grantId) return { created: false, reason: 'missing_outbound_message_id' }

    const expiresAt = getGrantExpiration(normalizedContext, now)
    if (!expiresAt) return { created: false, reason: 'no_future_options' }

    const guestEmail = guestEmails[0]
    const grant = {
        type: 'meeting_option_selection',
        status: 'active',
        ownerUserId: String(ownerUserId || '').trim(),
        projectId: String(projectId || '').trim(),
        assistantId: String(assistantId || '').trim(),
        ownerEmail: normalizedOwnerEmail,
        ownerName: String(ownerName || '').trim(),
        guestEmail,
        guestName: getEmailParticipantDisplayName(guestEmail),
        participantEmails: [normalizedOwnerEmail, guestEmail],
        language: String(language || '').trim(),
        subject: String(subject || '')
            .trim()
            .substring(0, 300),
        meetingSummary: buildMeetingSummary(subject, ownerName, guestEmail),
        safeActionContext: normalizedContext,
        inboundMessageId: String(inboundMessageId || '').trim(),
        outboundMessageId: normalizedOutboundMessageId,
        allowedAction: 'select_one_offered_slot',
        createdAt: now,
        updatedAt: now,
        expiresAt,
    }

    if (!grant.ownerUserId || !grant.projectId) return { created: false, reason: 'missing_owner_scope' }

    await admin.firestore().doc(`${GUEST_MEETING_GRANT_COLLECTION}/${grantId}`).set(grant)
    return { created: true, grantId, guestEmail, expiresAt }
}

async function resolveGuestMeetingGrant(payload = {}) {
    const senderEmail = normalizeEmailAddress(payload.fromEmail)
    if (!senderEmail) return null

    const directMessageIds = extractThreadMessageIds(payload.threadHeaders?.inReplyTo || '')
    const referencedMessageIds = extractThreadMessageIds(payload.threadHeaders?.references || '').reverse()
    const messageIds = [
        ...directMessageIds,
        ...referencedMessageIds.filter(messageId => !directMessageIds.includes(messageId)),
    ]
    if (messageIds.length === 0) return null

    for (const messageId of messageIds.slice(0, 20)) {
        const grantId = buildGuestMeetingGrantId(messageId)
        if (!grantId) continue

        const ref = admin.firestore().doc(`${GUEST_MEETING_GRANT_COLLECTION}/${grantId}`)
        const snapshot = await ref.get()
        if (!snapshot.exists) continue

        const grant = snapshot.data() || {}
        if (normalizeThreadMessageId(grant.outboundMessageId) !== messageId) continue
        if (normalizeEmailAddress(grant.guestEmail) !== senderEmail) continue
        if (grant.type !== 'meeting_option_selection' || grant.allowedAction !== 'select_one_offered_slot') continue

        return { ref, grantId, grant }
    }

    return null
}

function getCurrentReplyText(payload = {}) {
    const rawText = String(payload.textBody || '').trim() || stripHtmlToText(payload.htmlBody || '')
    return splitQuotedReplyText(rawText).newText
}

function normalizeSelectionText(value = '') {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

function extractTimeHints(text = '') {
    const hints = new Set()
    const add = (hourValue, minuteValue = '0') => {
        const hour = Number(hourValue)
        const minute = Number(minuteValue || 0)
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) hints.add(hour * 60 + minute)
    }

    for (const match of text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)) add(match[1], match[2])
    for (const match of text.matchAll(/\b([01]?\d|2[0-3])\s*uhr\b/g)) add(match[1])
    for (const match of text.matchAll(/\b(?:um|at)\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/g)) {
        add(match[1], match[2])
    }

    if (hints.size === 0 && text.length <= 120) {
        const bareNumbers = Array.from(text.matchAll(/\b([01]?\d|2[0-3])\b/g)).map(match => match[1])
        if (bareNumbers.length === 1) add(bareNumbers[0])
    }

    return hints
}

function extractDateHints(text = '', timeZone = 'UTC', now = Date.now()) {
    const dates = new Set()
    const weekdays = new Set()
    const nowInZone = moment(now).tz(timeZone || 'UTC')

    if (/\b(?:heute|today)\b/.test(text)) dates.add(nowInZone.format('YYYY-MM-DD'))
    if (/\b(?:morgen|tomorrow)\b/.test(text)) dates.add(nowInZone.clone().add(1, 'day').format('YYYY-MM-DD'))

    for (const match of text.matchAll(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](\d{2,4}))?\b/g)) {
        const day = Number(match[1])
        const month = Number(match[2])
        let year = match[3] ? Number(match[3]) : nowInZone.year()
        if (year < 100) year += 2000
        const parsed = moment.tz({ year, month: month - 1, date: day }, timeZone || 'UTC')
        if (parsed.isValid() && parsed.date() === day && parsed.month() === month - 1) {
            dates.add(parsed.format('YYYY-MM-DD'))
        }
    }

    const weekdayNames = [
        ['sonntag', 'sunday'],
        ['montag', 'monday'],
        ['dienstag', 'tuesday'],
        ['mittwoch', 'wednesday'],
        ['donnerstag', 'thursday'],
        ['freitag', 'friday'],
        ['samstag', 'saturday'],
    ]
    weekdayNames.forEach((names, weekday) => {
        if (names.some(name => new RegExp(`\\b${name}\\b`).test(text))) weekdays.add(weekday)
    })

    return { dates, weekdays }
}

function extractOrdinalIndex(text = '') {
    const numericMatch = text.match(/\b(?:option|slot|termin|vorschlag)\s*(?:nummer\s*)?(\d{1,2})\b/)
    if (numericMatch) return Number(numericMatch[1]) - 1

    const words = [
        /\b(?:erste|ersten|first)\b/,
        /\b(?:zweite|zweiten|second)\b/,
        /\b(?:dritte|dritten|third)\b/,
        /\b(?:vierte|vierten|fourth)\b/,
        /\b(?:funfte|funften|fifth)\b/,
    ]
    const index = words.findIndex(pattern => pattern.test(text))
    return index >= 0 ? index : null
}

function selectOfferedMeetingOption(replyText = '', safeActionContext = {}, { now = Date.now() } = {}) {
    const context = normalizeSafeEmailActionContext(safeActionContext)
    if (!context) return { status: 'ambiguous', option: null }

    const text = normalizeSelectionText(replyText)
    if (!text) return { status: 'ambiguous', option: null }

    const universalDecline = [
        /\bkeiner(?:\s+der\s+termine)?\b/,
        /\bkein(?:er)?\s+(?:termin|slot)\b/,
        /\bnone\s+of\b/,
        /\bno\s+(?:time|slot)\s+works\b/,
        /\b(?:muss|mochte)\s+absagen\b/,
        /\b(?:decline|cancel)\b/,
    ].some(pattern => pattern.test(text))
    if (universalDecline) return { status: 'declined', option: null }

    const timeZone = context.timeZone || 'UTC'
    const descriptors = context.options.map((option, index) => {
        const localStart = moment.parseZone(option.start).tz(timeZone)
        return {
            index,
            option,
            date: localStart.format('YYYY-MM-DD'),
            weekday: localStart.day(),
            minutes: localStart.hour() * 60 + localStart.minute(),
        }
    })

    const ordinalIndex = extractOrdinalIndex(text)
    if (ordinalIndex !== null && descriptors[ordinalIndex]) {
        return { status: 'selected', option: descriptors[ordinalIndex].option, optionIndex: ordinalIndex }
    }

    const timeHints = extractTimeHints(text)
    const dateHints = extractDateHints(text, timeZone, now)
    let candidates = descriptors
    if (timeHints.size > 0) candidates = candidates.filter(candidate => timeHints.has(candidate.minutes))
    if (dateHints.dates.size > 0) candidates = candidates.filter(candidate => dateHints.dates.has(candidate.date))
    if (dateHints.weekdays.size > 0) {
        candidates = candidates.filter(candidate => dateHints.weekdays.has(candidate.weekday))
    }

    if (candidates.length === 1) {
        return {
            status: 'selected',
            option: candidates[0].option,
            optionIndex: candidates[0].index,
        }
    }

    const affirmative = /\b(?:ja|yes|passt|works|nehme|take|bestatige|confirm)\b/.test(text)
    if (descriptors.length === 1 && affirmative) {
        return { status: 'selected', option: descriptors[0].option, optionIndex: 0 }
    }

    const simpleDecline = /\b(?:passt\s+(?:leider\s+)?nicht|doesn'?t\s+work|cannot\s+make\s+it)\b/.test(text)
    if (simpleDecline && timeHints.size === 0) return { status: 'declined', option: null }

    return { status: 'ambiguous', option: null }
}

function optionMatches(first = {}, second = {}) {
    return Date.parse(first.start) === Date.parse(second.start) && Date.parse(first.end) === Date.parse(second.end)
}

async function claimGrantForBooking(ref, payloadMessageId, option, now = Date.now()) {
    let result = { claimed: false, status: 'missing' }
    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return
        const grant = snapshot.data() || {}
        if (grant.status !== 'active') {
            result = { claimed: false, status: grant.status || 'inactive', grant }
            return
        }
        if (Number(grant.expiresAt || 0) <= now) {
            transaction.update(ref, { status: 'expired', updatedAt: now })
            result = { claimed: false, status: 'expired', grant }
            return
        }

        transaction.update(ref, {
            status: 'processing',
            processingMessageId: String(payloadMessageId || '').trim(),
            selectedOption: option,
            updatedAt: now,
        })
        result = { claimed: true, status: 'processing', grant }
    })
    return result
}

async function transitionActiveGrant(ref, status, patch = {}, now = Date.now()) {
    let result = { transitioned: false, status: 'missing' }
    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return

        const grant = snapshot.data() || {}
        if (grant.status !== 'active') {
            result = { transitioned: false, status: grant.status || 'inactive', grant }
            return
        }

        transaction.update(ref, {
            status,
            updatedAt: now,
            ...patch,
        })
        result = { transitioned: true, status, grant }
    })
    return result
}

async function markGrantStatus(ref, status, patch = {}) {
    await ref.update({
        status,
        updatedAt: Date.now(),
        ...patch,
    })
}

async function recheckOfferedOption(grant, option) {
    const durationMinutes = Math.max(1, Math.round((Date.parse(option.end) - Date.parse(option.start)) / 60000))
    const result = await findCalendarAvailabilityForAssistantRequest({
        userId: grant.ownerUserId,
        timeMin: option.start,
        timeMax: option.end,
        timeZone: grant.safeActionContext?.timeZone,
        durationMinutes,
        maxOptions: 1,
        slotIntervalMinutes: 5,
        minFreeHoursPerDay: 0,
        allowSameDayBooking: true,
        respectPublicMeetingLinkSettings: true,
    })
    return result?.success === true && (result.options || []).some(candidate => optionMatches(candidate, option))
}

function isGermanGrant(grant = {}) {
    const language = String(grant.language || '').toLowerCase()
    return language.startsWith('de') || language.startsWith('german') || language.startsWith('deutsch')
}

function buildGrantReplyText(grant, status, details = {}) {
    const german = isGermanGrant(grant)
    const ownerName = String(grant.ownerName || '').trim()
    const sentenceOwnerLabel = ownerName || (german ? 'Die Person mit dem Alldone-Konto' : 'The Alldone account owner')
    const objectOwnerLabel = ownerName || (german ? 'die Person mit dem Alldone-Konto' : 'the Alldone account owner')
    if (status === 'ambiguous') {
        return german
            ? 'Bitte antworte mit genau einem der vorgeschlagenen Termine einschließlich Datum und Uhrzeit. Ich kann in dieser E-Mail ausschließlich einen dieser Termine bestätigen.'
            : 'Please reply with exactly one of the proposed times, including its date and time. In this email I can only confirm one of those options.'
    }
    if (status === 'declined') {
        return german
            ? `Alles klar – ich habe vermerkt, dass keiner der vorgeschlagenen Termine passt. ${sentenceOwnerLabel} kann neue Zeiten vorschlagen.`
            : `Understood — I noted that none of the proposed times work. ${sentenceOwnerLabel} can propose new options.`
    }
    if (status === 'expired') {
        return german
            ? `Diese Terminvorschläge sind nicht mehr gültig. ${sentenceOwnerLabel} muss neue Zeiten über Anna vorschlagen.`
            : `These meeting options are no longer valid. Please ask ${objectOwnerLabel} to propose new times through Anna.`
    }
    if (status === 'unavailable') {
        return german
            ? `Dieser Termin ist inzwischen nicht mehr verfügbar. ${sentenceOwnerLabel} kann neue Zeiten über Anna vorschlagen.`
            : `That time is no longer available. ${sentenceOwnerLabel} can propose new times through Anna.`
    }
    if (status === 'processing') {
        return german
            ? 'Diese Terminantwort wird bereits verarbeitet. Ich erstelle keinen zweiten Termin.'
            : 'This meeting response is already being processed. I will not create a second event.'
    }
    if (status === 'failed') {
        return german
            ? `Ich konnte den Termin nicht sicher eintragen. ${sentenceOwnerLabel} muss die Buchung bitte prüfen oder neue Zeiten vorschlagen.`
            : `I could not safely create the event. ${sentenceOwnerLabel} will need to check the booking or propose new times.`
    }
    if (status === 'booked') {
        if (details.confirmationText) return details.confirmationText
        const option = details.option || {}
        const timeZone = grant.safeActionContext?.timeZone || 'UTC'
        const start = moment.parseZone(option.start).tz(timeZone)
        const end = moment.parseZone(option.end).tz(timeZone)
        const ownerName = grant.ownerName || 'the account owner'
        const joinLine = details.joinUrl ? `\nGoogle Meet: ${details.joinUrl}` : ''
        return german
            ? `Der Termin mit ${ownerName} ist für ${start.format('DD.MM.YYYY')}, ${start.format(
                  'HH:mm'
              )}–${end.format('HH:mm')} Uhr (${timeZone}) eingetragen.${joinLine}`
            : `The meeting with ${ownerName} is booked for ${start.format('YYYY-MM-DD')}, ${start.format(
                  'HH:mm'
              )}–${end.format('HH:mm')} (${timeZone}).${joinLine}`
    }
    return german
        ? 'Diese Terminantwort konnte nicht verarbeitet werden.'
        : 'This meeting response could not be processed.'
}

function resolveGrantReplyStatus(status, fallback = 'expired') {
    if (status === 'used') return 'booked'
    if (['processing', 'declined', 'expired', 'failed'].includes(status)) return status
    return fallback
}

function buildReplySubject(subject = '') {
    const normalized = String(subject || '').trim()
    if (!normalized) return 'Re: Meeting with Anna at Alldone'
    return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`
}

function sanitizeThreadHeader(value = '') {
    return String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 4000)
}

async function sendGuestMeetingReply(grant, payload, replyText) {
    const fromEmail = getEnvFunctions().ANNA_EMAIL_PUBLIC_ADDRESS || DEFAULT_PUBLIC_EMAIL
    const references = [
        sanitizeThreadHeader(payload.threadHeaders?.references || ''),
        sanitizeThreadHeader(payload.messageId || ''),
    ]
        .filter(Boolean)
        .join(' ')
    return sendAnnaEmailReply({
        toEmails: buildDailyEmailParticipantEmails(grant.participantEmails || [grant.ownerEmail, grant.guestEmail]),
        subject: buildReplySubject(grant.subject || payload.subject),
        replyText,
        inReplyTo: sanitizeThreadHeader(payload.messageId || payload.threadHeaders?.inReplyTo || ''),
        references,
        fromEmail,
    })
}

async function sendGuestMeetingReplySafely(grant, payload, replyText, grantId = '') {
    try {
        const result = await sendGuestMeetingReply(grant, payload, replyText)
        return { sent: true, result }
    } catch (error) {
        console.error('Email Channel: Failed sending guest meeting reply', {
            grantId,
            messageId: payload.messageId || '',
            error: error.message,
        })
        return { sent: false, error }
    }
}

async function tryHandleGuestMeetingReply(payload = {}) {
    const resolved = await resolveGuestMeetingGrant(payload)
    if (!resolved) return { matched: false }

    const { ref, grantId, grant } = resolved
    const now = Date.now()
    if (Number(grant.expiresAt || 0) <= now && grant.status === 'active') {
        const transition = await transitionActiveGrant(ref, 'expired', {}, now)
        const currentGrant = transition.grant || grant
        const status = transition.transitioned ? 'expired' : resolveGrantReplyStatus(transition.status)
        const replyText = buildGrantReplyText(currentGrant, status, {
            confirmationText: currentGrant.confirmationText || '',
            option: currentGrant.selectedOption,
            joinUrl: currentGrant.joinUrl || '',
        })
        await sendGuestMeetingReplySafely(currentGrant, payload, replyText, grantId)
        return {
            matched: true,
            status: `guest_meeting_${transition.transitioned ? 'expired' : transition.status}`,
            ownerUserId: currentGrant.ownerUserId,
            grantId,
        }
    }

    if (grant.status === 'used') {
        const replyText = buildGrantReplyText(grant, 'booked', {
            confirmationText: grant.confirmationText || '',
            option: grant.selectedOption,
            joinUrl: grant.joinUrl || '',
        })
        await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
        return { matched: true, status: 'guest_meeting_already_booked', ownerUserId: grant.ownerUserId, grantId }
    }

    if (grant.status === 'processing') {
        const replyText = buildGrantReplyText(grant, 'processing')
        await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
        return { matched: true, status: 'guest_meeting_processing', ownerUserId: grant.ownerUserId, grantId }
    }

    if (grant.status !== 'active') {
        const replyText = buildGrantReplyText(grant, resolveGrantReplyStatus(grant.status))
        await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
        return {
            matched: true,
            status: `guest_meeting_${grant.status || 'inactive'}`,
            ownerUserId: grant.ownerUserId,
            grantId,
        }
    }

    const selection = selectOfferedMeetingOption(getCurrentReplyText(payload), grant.safeActionContext, { now })
    if (selection.status === 'ambiguous') {
        const replyText = buildGrantReplyText(grant, 'ambiguous')
        await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
        return { matched: true, status: 'guest_meeting_clarification', ownerUserId: grant.ownerUserId, grantId }
    }

    if (selection.status === 'declined') {
        const transition = await transitionActiveGrant(
            ref,
            'declined',
            {
                declinedMessageId: String(payload.messageId || '').trim(),
            },
            now
        )
        const currentGrant = transition.grant || grant
        const status = transition.transitioned ? 'declined' : resolveGrantReplyStatus(transition.status, 'declined')
        const replyText = buildGrantReplyText(currentGrant, status, {
            confirmationText: currentGrant.confirmationText || '',
            option: currentGrant.selectedOption,
            joinUrl: currentGrant.joinUrl || '',
        })
        await sendGuestMeetingReplySafely(currentGrant, payload, replyText, grantId)
        return {
            matched: true,
            status: `guest_meeting_${transition.transitioned ? 'declined' : transition.status}`,
            ownerUserId: currentGrant.ownerUserId,
            grantId,
        }
    }

    const option = selection.option
    if (!option || Date.parse(option.start) <= now) {
        const replyText = buildGrantReplyText(grant, 'unavailable')
        await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
        return { matched: true, status: 'guest_meeting_unavailable', ownerUserId: grant.ownerUserId, grantId }
    }

    const claim = await claimGrantForBooking(ref, payload.messageId, option, now)
    if (!claim.claimed) {
        const status = resolveGrantReplyStatus(claim.status)
        const replyText = buildGrantReplyText(claim.grant || grant, status, {
            confirmationText: claim.grant?.confirmationText || '',
            option: claim.grant?.selectedOption || option,
            joinUrl: claim.grant?.joinUrl || '',
        })
        await sendGuestMeetingReplySafely(claim.grant || grant, payload, replyText, grantId)
        return { matched: true, status: `guest_meeting_${claim.status}`, ownerUserId: grant.ownerUserId, grantId }
    }

    try {
        const stillAvailable = await recheckOfferedOption(grant, option)
        if (!stillAvailable) {
            await markGrantStatus(ref, 'active', {
                processingMessageId: null,
                selectedOption: null,
            })
            const replyText = buildGrantReplyText(grant, 'unavailable')
            await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
            return { matched: true, status: 'guest_meeting_unavailable', ownerUserId: grant.ownerUserId, grantId }
        }

        const eventResult = await createCalendarEventForAssistantRequest({
            userId: grant.ownerUserId,
            summary: grant.meetingSummary,
            start: option.start,
            end: option.end,
            timeZone: grant.safeActionContext?.timeZone,
            attendees: [grant.guestEmail],
        })
        if (eventResult?.success !== true) throw new Error(eventResult?.message || 'Calendar event creation failed')

        const confirmationText = buildGrantReplyText(grant, 'booked', {
            option,
            joinUrl: eventResult.joinUrl || '',
        })
        await markGrantStatus(ref, 'used', {
            usedAt: Date.now(),
            usedMessageId: String(payload.messageId || '').trim(),
            selectedOption: option,
            eventId: String(eventResult.event?.eventId || '').trim(),
            calendarId: String(eventResult.calendarId || '').trim(),
            joinUrl: String(eventResult.joinUrl || '').trim(),
            confirmationText,
        })
        const confirmation = await sendGuestMeetingReplySafely(grant, payload, confirmationText, grantId)
        return {
            matched: true,
            status: confirmation.sent ? 'guest_meeting_booked' : 'guest_meeting_booked_confirmation_failed',
            ownerUserId: grant.ownerUserId,
            grantId,
        }
    } catch (error) {
        console.error('Email Channel: Guest meeting booking failed', {
            grantId,
            messageId: payload.messageId || '',
            error: error.message,
        })
        await markGrantStatus(ref, 'failed', {
            failedAt: Date.now(),
            failureMessage: String(error.message || 'Unknown booking error').substring(0, 300),
        })
        const replyText = buildGrantReplyText(grant, 'failed')
        await sendGuestMeetingReplySafely(grant, payload, replyText, grantId)
        return { matched: true, status: 'guest_meeting_failed', ownerUserId: grant.ownerUserId, grantId }
    }
}

module.exports = {
    maybeCreateGuestMeetingGrant,
    tryHandleGuestMeetingReply,
    __private__: {
        buildGuestMeetingGrantId,
        buildGrantReplyText,
        buildMeetingSummary,
        extractThreadMessageIds,
        extractTimeHints,
        getCurrentReplyText,
        isGuestMeetingProposalRequest,
        normalizeThreadMessageId,
        recheckOfferedOption,
        resolveGrantReplyStatus,
        resolveGuestMeetingGrant,
        selectOfferedMeetingOption,
        sanitizeThreadHeader,
        sendGuestMeetingReplySafely,
        transitionActiveGrant,
    },
}
