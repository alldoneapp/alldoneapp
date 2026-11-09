'use strict'

/**
 * MCP feed parity: Gmail and Calendar.
 *
 * Every change an MCP client or an assistant makes in the user's mailbox or calendar through a tool
 * call writes one Updates entry, on the project the connection belongs to (the connection's
 * `defaultProjectId`; the user's default project when that is not a project the user is a member of).
 * Members of that project see the line; only the owner of the mailbox gets the unread badge.
 *
 * Called from `executeToolNatively` (Assistant/assistantHelper.js) after the tool returned, so it runs
 * for MCP (assistantId = null, actor "Karsten Wysk (via Claude)") and for assistants (actor = the
 * assistant) alike, and for nothing else: the email line, public booking, the guest-meeting grant and
 * the labeling sync call the same Gmail/Calendar helpers directly and write no entry.
 *
 * What an entry may say: subject or event title, recipient or attendee names (the address when no
 * name is known), label names, the event time. Never a body or an event description, never Bcc.
 * A failed call or one that changed nothing writes nothing. Several email changes of the same kind
 * by the same actor in the same project within BURST_WINDOW_MS stay ONE entry with a count
 * ("archived 3 emails"): the entry is rewritten under its own id. Writing the entry is best effort —
 * it never fails or changes the tool result.
 */

const crypto = require('crypto')
const moment = require('moment-timezone')

const { FEED_PROJECT_EMAIL_ACTIVITY, FEED_PROJECT_CALENDAR_ACTIVITY } = require('./FeedsConstants')

const SERVICE_EMAIL = 'email'
const SERVICE_CALENDAR = 'calendar'

const INTEGRATION_ACTIVITY_TOOLS = {
    create_gmail_draft: SERVICE_EMAIL,
    create_gmail_reply_draft: SERVICE_EMAIL,
    update_gmail_draft: SERVICE_EMAIL,
    update_gmail_email: SERVICE_EMAIL,
    correct_email_classification: SERVICE_EMAIL,
    create_calendar_event: SERVICE_CALENDAR,
    update_calendar_event: SERVICE_CALENDAR,
    delete_calendar_event: SERVICE_CALENDAR,
}
const INTEGRATION_ACTIVITY_TOOL_NAMES = new Set(Object.keys(INTEGRATION_ACTIVITY_TOOLS))

const BURST_WINDOW_MS = 10 * 60 * 1000
const BURST_STATE_DOC = 'integrationActivityFeed'
const DEFAULT_DATE_FORMAT = 'DD.MM.YYYY'
const TITLE_LIMIT = 60
const PEOPLE_SHOWN = 2

function cleanText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function quoted(value) {
    const { shrinkTagText } = require('../Utils/parseTextUtils')
    const text = cleanText(value)
    return text ? `'${shrinkTagText(text, TITLE_LIMIT)}'` : ''
}

function joinWithAnd(parts) {
    const list = parts.filter(Boolean)
    if (list.length <= 1) return list[0] || ''
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

// "Anna Becker <anna@acme.com>" → "Anna Becker"; a bare address stays the address.
function recipientDisplayName(recipient) {
    if (recipient && typeof recipient === 'object') {
        return cleanText(recipient.displayName) || cleanText(recipient.name) || cleanText(recipient.email)
    }
    const text = cleanText(recipient)
    const match = text.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/)
    if (match) return cleanText(match[1]) || cleanText(match[2])
    return text
}

function formatPeople(list) {
    const names = (Array.isArray(list) ? list : []).map(recipientDisplayName).filter(Boolean)
    if (names.length === 0) return ''
    if (names.length <= PEOPLE_SHOWN + 1) return joinWithAnd(names)
    const others = names.length - PEOPLE_SHOWN
    return `${names.slice(0, PEOPLE_SHOWN).join(', ')} and ${others} others`
}

function isIanaZone(value) {
    return typeof value === 'string' && !!value.trim() && !!moment.tz.zone(value.trim())
}

function resolveUserTimeZone(userData = {}) {
    const candidate = [userData.timezone, userData.preferredTimezone].find(isIanaZone)
    return candidate ? candidate.trim() : ''
}

// Google returns `dateTime` with an offset; Microsoft Graph returns a wall time plus `timeZone`
// (UTC unless asked otherwise). Shown in the user's own zone when it is known.
function formatEventStart(start, { dateFormat = DEFAULT_DATE_FORMAT, timeZone = '' } = {}) {
    if (!start || typeof start !== 'object') return ''
    const format = typeof dateFormat === 'string' && dateFormat.trim() ? dateFormat.trim() : DEFAULT_DATE_FORMAT
    if (start.date && !start.dateTime) {
        const day = moment(start.date, 'YYYY-MM-DD', true)
        return day.isValid() ? day.format(format) : ''
    }
    const raw = typeof start.dateTime === 'string' ? start.dateTime.trim() : ''
    if (!raw) return ''
    let instant
    if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) instant = moment.parseZone(raw)
    else if (isIanaZone(start.timeZone)) instant = moment.tz(raw, start.timeZone.trim())
    else instant = moment.utc(raw)
    if (!instant.isValid()) return ''
    const zone = isIanaZone(timeZone) ? timeZone : isIanaZone(start.timeZone) ? start.timeZone.trim() : ''
    return (zone ? instant.clone().tz(zone) : instant).format(`${format} HH:mm`)
}

function isMicrosoft(result) {
    return result?.provider === 'microsoft'
}

// ---------------------------------------------------------------------------------------------
// Email label changes. `changedLabels` holds what the call really changed (the tools compare with
// the message before the change): system labels by id (INBOX, UNREAD, ...), the user's labels by
// name. Each phrase takes its object, so one sentence can cover one email or a burst of them.
// ---------------------------------------------------------------------------------------------

const SYSTEM_LABEL_PHRASES = {
    '-INBOX': o => `archived ${o}`,
    '+INBOX': o => `moved ${o} to the inbox`,
    '+TRASH': o => `moved ${o} to the trash`,
    '-TRASH': o => `restored ${o} from the trash`,
    '+SPAM': o => `marked ${o} as spam`,
    '-SPAM': o => `marked ${o} as not spam`,
    '-UNREAD': o => `marked ${o} as read`,
    '+UNREAD': o => `marked ${o} as unread`,
    '+STARRED': o => `starred ${o}`,
    '-STARRED': o => `unstarred ${o}`,
    '+IMPORTANT': o => `marked ${o} as important`,
    '-IMPORTANT': o => `marked ${o} as not important`,
}

function labelDisplayName(label) {
    const text = cleanText(label)
    const category = text.match(/^CATEGORY_(\w+)$/)
    if (!category) return text
    const name = category[1].toLowerCase()
    return name.charAt(0).toUpperCase() + name.slice(1)
}

function normalizeChangedLabels(changedLabels) {
    const list = value => [...new Set((Array.isArray(value) ? value : []).map(cleanText).filter(Boolean))]
    return { added: list(changedLabels?.added), removed: list(changedLabels?.removed) }
}

function buildEmailChangePhrases({ added, removed }) {
    const phrases = []
    Object.entries(SYSTEM_LABEL_PHRASES).forEach(([token, phrase]) => {
        const label = token.slice(1)
        const list = token[0] === '+' ? added : removed
        if (list.includes(label)) phrases.push(phrase)
    })
    const isSystem = label => SYSTEM_LABEL_PHRASES[`+${label}`] || SYSTEM_LABEL_PHRASES[`-${label}`]
    const addedNames = added.filter(label => !isSystem(label)).map(labelDisplayName)
    const removedNames = removed.filter(label => !isSystem(label)).map(labelDisplayName)
    if (addedNames.length > 0) phrases.push(o => `labeled ${o} as ${joinWithAnd(addedNames)}`)
    if (removedNames.length > 0) {
        const noun = removedNames.length === 1 ? 'the label' : 'the labels'
        phrases.push(o => `removed ${noun} ${joinWithAnd(removedNames)} from ${o}`)
    }
    return phrases
}

function composeEmailChangeSentence(phrases, object, pronoun) {
    return joinWithAnd(phrases.map((phrase, index) => phrase(index === 0 ? object : pronoun)))
}

function buildEmailUpdateActivity(result) {
    const changes = normalizeChangedLabels(result.changedLabels)
    const phrases = buildEmailChangePhrases(changes)
    if (phrases.length === 0) return null
    const subject = quoted(result.subject)
    const singleObject = subject ? `the email ${subject}` : 'an email'
    const signature = [...changes.added.map(label => `+${label}`), ...changes.removed.map(label => `-${label}`)]
        .sort()
        .join('|')
    return {
        entryText: composeEmailChangeSentence(phrases, singleObject, 'it'),
        burst: {
            signature: `email:${signature}`,
            textForCount: count => composeEmailChangeSentence(phrases, `${count} emails`, 'them'),
        },
    }
}

const DRAFT_CHANGE_ARG_KEYS = ['to', 'cc', 'bcc', 'subject', 'body']

function draftUpdateChangedAnything(toolArgs = {}, result = {}) {
    if (result.changed === false) return false
    if (result.changed === true) return true
    if (DRAFT_CHANGE_ARG_KEYS.some(key => toolArgs[key] !== undefined)) return true
    if (Array.isArray(toolArgs.attachments) && toolArgs.attachments.length > 0) return true
    if (Array.isArray(toolArgs.removeAttachmentFileNames) && toolArgs.removeAttachmentFileNames.length > 0) return true
    return toolArgs.replaceAttachments === true
}

function describeDraft(kind, result, subject) {
    const product = isMicrosoft(result) ? 'Outlook' : 'Gmail'
    const article = kind === 'created' ? (isMicrosoft(result) ? 'an' : 'a') : 'the'
    const recipients = formatPeople(result.to)
    return [`${kind} ${article} ${product} draft`, quoted(subject), recipients ? `to ${recipients}` : '']
        .filter(Boolean)
        .join(' ')
}

function replySubject(subject) {
    const text = cleanText(subject)
    if (!text) return ''
    return /^re:/i.test(text) ? text : `Re: ${text}`
}

function describeClassificationCorrection(result) {
    const subject = quoted(result.subject)
    const target = [cleanText(result.correctLabel), cleanText(result.correctFollowUpType)].filter(Boolean)
    const to = target.length === 2 ? `${target[0]} (${target[1]})` : target[0] || ''
    return [`corrected the classification of ${subject ? `the email ${subject}` : 'an email'}`, to ? `to ${to}` : '']
        .filter(Boolean)
        .join(' ')
}

function describeEventCreated(toolArgs, result, dateOptions) {
    const event = result.event || {}
    const title = quoted(event.summary || toolArgs.summary)
    const when = formatEventStart(event.start, dateOptions)
    const attendees = formatPeople(event.attendees && event.attendees.length > 0 ? event.attendees : toolArgs.attendees)
    return [
        title ? `created the calendar event ${title}` : 'created a calendar event',
        when ? `on ${when}` : '',
        attendees ? `with ${attendees}` : '',
        toolArgs.recurrence ? '(recurring)' : '',
    ]
        .filter(Boolean)
        .join(' ')
}

function describeEventUpdated(toolArgs, result, dateOptions) {
    const event = result.event || {}
    const title = quoted(event.summary || toolArgs.summary)
    const changes = []
    if (toolArgs.start !== undefined || toolArgs.end !== undefined) {
        const when = formatEventStart(event.start, dateOptions)
        changes.push(when ? `the time to ${when}` : 'the time')
    }
    if (toolArgs.summary !== undefined) changes.push('the title')
    if (toolArgs.location !== undefined) changes.push('the location')
    if (toolArgs.attendees !== undefined) changes.push('the attendees')
    if (toolArgs.description !== undefined) changes.push('the description')
    if (toolArgs.recurrence !== undefined) changes.push('the recurrence')
    const base = title ? `updated the calendar event ${title}` : 'updated a calendar event'
    const series = toolArgs.scope === 'series' ? ' (all occurrences)' : ''
    return changes.length > 0 ? `${base}${series} • changed ${joinWithAnd(changes)}` : `${base}${series}`
}

function describeEventDeleted(toolArgs, result, dateOptions) {
    const title = quoted(result.summary)
    const when = formatEventStart(result.start, dateOptions)
    return [
        title ? `deleted the calendar event ${title}` : 'deleted a calendar event',
        when ? `on ${when}` : '',
        toolArgs.scope === 'series' ? '(all occurrences)' : '',
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * What one successful tool call becomes in the Updates feed, or null when it writes nothing.
 * Pure: `dateOptions` carries the user's date format and IANA time zone.
 */
function buildIntegrationActivity(toolName, toolArgs = {}, result = {}, dateOptions = {}) {
    const service = INTEGRATION_ACTIVITY_TOOLS[toolName]
    if (!service || !result || result.success !== true) return null
    const args = toolArgs && typeof toolArgs === 'object' ? toolArgs : {}
    const feedType = service === SERVICE_CALENDAR ? FEED_PROJECT_CALENDAR_ACTIVITY : FEED_PROJECT_EMAIL_ACTIVITY
    const connectionKey = cleanText(result.projectId) || cleanText(args.projectId)
    const base = { service, feedType, connectionKey, burst: null }

    switch (toolName) {
        case 'create_gmail_draft':
            return { ...base, entryText: describeDraft('created', result, result.subject || args.subject) }
        case 'create_gmail_reply_draft': {
            const product = isMicrosoft(result) ? 'an Outlook' : 'a Gmail'
            const subject = quoted(replySubject(result.targetSubject || result.subject))
            const recipients = formatPeople(result.to)
            const entryText = [`created ${product} reply draft`, subject, recipients ? `to ${recipients}` : '']
                .filter(Boolean)
                .join(' ')
            return { ...base, entryText }
        }
        case 'update_gmail_draft':
            if (!draftUpdateChangedAnything(args, result)) return null
            return { ...base, entryText: describeDraft('updated', result, result.subject) }
        case 'update_gmail_email': {
            const activity = buildEmailUpdateActivity(result)
            return activity ? { ...base, ...activity } : null
        }
        case 'correct_email_classification':
            return {
                ...base,
                entryText: describeClassificationCorrection({
                    ...result,
                    correctFollowUpType: ['actionable', 'informational'].includes(args.correctFollowUpType)
                        ? args.correctFollowUpType
                        : '',
                    correctLabel: result.correctLabel || args.correctLabel,
                }),
            }
        case 'create_calendar_event':
            return { ...base, entryText: describeEventCreated(args, result, dateOptions) }
        case 'update_calendar_event':
            return { ...base, entryText: describeEventUpdated(args, result, dateOptions) }
        case 'delete_calendar_event':
            return { ...base, entryText: describeEventDeleted(args, result, dateOptions) }
        default:
            return null
    }
}

// ---------------------------------------------------------------------------------------------
// Which project the entry goes to.
// ---------------------------------------------------------------------------------------------

async function readMemberProject(db, userId, projectId) {
    if (!projectId) return null
    const { isProjectMemberData } = require('../shared/privacyAccess')
    const snapshot = await db
        .doc(`projects/${projectId}`)
        .get()
        .catch(() => null)
    if (!snapshot?.exists) return null
    const project = snapshot.data() || {}
    return isProjectMemberData(project, userId) ? { projectId, project: { ...project, id: projectId } } : null
}

/**
 * The tools report the connection they used as `projectId`: an account-level connection id
 * (`email_google_…`, `calendar_google_…`) or, for older connections, the project it was made in.
 * The connection belongs to its `defaultProjectId`; without one that the user is a member of the
 * entry goes to the user's default project, and without that to nowhere.
 */
async function resolveIntegrationFeedProject({ db, userId, userData = {}, service, connectionKey }) {
    const { getConnection } = require('../Integrations/providerConnections')
    const candidates = []
    const key = cleanText(connectionKey)
    if (key) {
        const connection = getConnection(userData, service, key)
        if (connection?.defaultProjectId) candidates.push(connection.defaultProjectId)
        else if (!connection && !/^(email|calendar)_/.test(key)) candidates.push(key)
    }
    if (typeof userData.defaultProjectId === 'string') candidates.push(userData.defaultProjectId)

    for (const projectId of [...new Set(candidates.filter(Boolean))]) {
        const target = await readMemberProject(db, userId, projectId)
        if (target) return target
    }
    return null
}

// ---------------------------------------------------------------------------------------------
// Bursts: one entry for a run of the same email change. The state is one small document per user,
// written only here; an entry older than the window, or from another day, starts a new burst.
// ---------------------------------------------------------------------------------------------

function buildBurstKey(projectId, feedUser = {}, signature = '') {
    const actor = [feedUser.uid || '', feedUser.via || '', feedUser.viaClient || ''].join('/')
    return crypto.createHash('sha1').update(`${projectId}|${actor}|${signature}`).digest('hex').slice(0, 24)
}

async function claimBurstEntry({ db, userId, burstKey, dateFormated, now, newFeedId }) {
    const ref = db.doc(`users/${userId}/private/${BURST_STATE_DOC}`)
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const bursts = (snapshot.exists && snapshot.data()?.bursts) || {}
        const previous = bursts[burstKey]
        const continues =
            previous &&
            typeof previous.feedId === 'string' &&
            previous.dateFormated === dateFormated &&
            Number.isFinite(previous.lastAt) &&
            now - previous.lastAt <= BURST_WINDOW_MS
        const entry = continues
            ? { feedId: previous.feedId, count: (Number(previous.count) || 1) + 1, lastAt: now, dateFormated }
            : { feedId: newFeedId, count: 1, lastAt: now, dateFormated }

        const kept = {}
        Object.entries(bursts).forEach(([key, value]) => {
            if (value && Number.isFinite(value.lastAt) && now - value.lastAt <= BURST_WINDOW_MS) kept[key] = value
        })
        kept[burstKey] = entry
        transaction.set(ref, { bursts: kept })
        return entry
    })
}

/**
 * Writes the Updates entry for one finished tool call. Never throws; returns what it wrote, or null.
 * `getFeedUser` resolves the actor (Assistant/assistantHelper.js getAssistantFeedUserForTool): the
 * assistant, or the user with the MCP marker.
 */
async function recordIntegrationToolActivity({ db, toolName, toolArgs, result, userId, getFeedUser }) {
    if (!INTEGRATION_ACTIVITY_TOOL_NAMES.has(toolName) || result?.success !== true || !userId || !db) return null
    try {
        const userSnapshot = await db.doc(`users/${userId}`).get()
        const userData = (userSnapshot?.exists && userSnapshot.data()) || {}
        const activity = buildIntegrationActivity(toolName, toolArgs, result, {
            dateFormat: userData.dateFormat,
            timeZone: resolveUserTimeZone(userData),
        })
        if (!activity) return null

        const target = await resolveIntegrationFeedProject({
            db,
            userId,
            userData,
            service: activity.service,
            connectionKey: activity.connectionKey,
        })
        if (!target) {
            console.warn('[integrationToolFeeds] No project to write the Updates entry to', { toolName, userId })
            return null
        }

        const feedUser = await getFeedUser()
        if (!feedUser?.uid) return null

        const { loadFeedsStateForContactWrite } = require('../shared/contactUpdateHelper')
        await loadFeedsStateForContactWrite({ db, projectId: target.projectId, feedUser, userId })

        const { generateCurrentDateObject } = require('./globalFeedsHelper')
        const { getId } = require('../Firestore/generalFirestoreCloud')
        const dateObject = generateCurrentDateObject()
        let feedId = null
        let entryText = activity.entryText
        if (activity.burst) {
            const claim = await claimBurstEntry({
                db,
                userId,
                burstKey: buildBurstKey(target.projectId, feedUser, activity.burst.signature),
                dateFormated: dateObject.currentDateFormated,
                now: dateObject.currentMilliseconds,
                newFeedId: getId(),
            }).catch(error => {
                console.warn('[integrationToolFeeds] Could not join the entry to a burst', { error: error?.message })
                return null
            })
            if (claim) {
                feedId = claim.feedId
                if (claim.count > 1) entryText = activity.burst.textForCount(claim.count)
            }
        }

        const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
        const { createProjectIntegrationActivityFeed } = require('./projectsFeeds')
        const batch = new BatchWrapper(db)
        const written = await createProjectIntegrationActivityFeed(
            target.projectId,
            target.project,
            activity.feedType,
            entryText,
            batch,
            feedUser,
            { feedId, notifyUserIds: [userId], dateObject }
        )
        await batch.commit()
        return {
            projectId: target.projectId,
            feedType: activity.feedType,
            feedId: written?.feedId || feedId,
            entryText,
        }
    } catch (error) {
        console.warn('[integrationToolFeeds] Could not write the Updates entry', { toolName, error: error?.message })
        return null
    }
}

module.exports = {
    BURST_WINDOW_MS,
    INTEGRATION_ACTIVITY_TOOL_NAMES,
    buildBurstKey,
    buildIntegrationActivity,
    claimBurstEntry,
    formatEventStart,
    formatPeople,
    recordIntegrationToolActivity,
    resolveIntegrationFeedProject,
}
