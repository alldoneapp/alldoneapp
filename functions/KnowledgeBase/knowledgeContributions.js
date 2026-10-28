'use strict'

// "Save this to the wiki": knowledge a member asks to keep that only exists in a conversation —
// something they stated, or an answer an assistant worked out with them. It becomes a source of its
// own (knowledgeBases/{projectId}/contributions/{id}, cited as [[contribution:ID]]) that the next
// ingest run, asked for right away, works into the pages it concerns, exactly like a document a
// member added (knowledgeDocuments.js). Like a correction or a document it lives inside the wiki
// tree and shares the wiki's audience, the project's members.
//
// What makes it different from both is that its text is not a file and not a correction: it can be
// a model's synthesis, and it can come from a conversation that saw things the project must not see
// (a private task, an email, the member's own notes). Three rules follow.
//
//   - Only on an explicit request. The tool description and the assistant context say so; the
//     server cannot tell, so the rest of the design assumes it may be asked when it should not be.
//   - Nothing ambiguous is shared without the member seeing the exact text first. When the text is
//     an assistant's summary rather than the member's own words, when it may draw on private
//     information, or when it goes into another project's wiki than the conversation's, the first
//     call only stores a DRAFT and returns the text; it is saved when the member confirms. The
//     draft lives in a server-only collection (knowledgeContributionDrafts, no client rule), never
//     in the wiki tree, because members can read that whole tree straight from Firestore. Where the
//     channel carries message ids (the in-app chat, WhatsApp), confirming needs a later message than
//     the one the draft was made in, so a model cannot confirm its own draft in the same turn.
//   - It is not a verified source. Its card says who saved it and that it is a member's statement
//     or a summary they confirmed (collectKnowledgeSources.buildContributionCard), and the ingest
//     rules tell the model to attribute what only a contribution supports and to keep a
//     disagreement with other sources as an open question rather than resolving it.
//
// Text that obviously must not be on a page (email addresses, phone numbers, credentials) is refused
// outright, whatever the confirmation. Removing a contribution goes through the same invalidation as
// a removed document: every page that cited it is emptied, hidden and rebuilt from its other sources,
// its revisions are redacted, and the stored text is deleted.

const crypto = require('crypto')
const { FieldValue } = require('firebase-admin/firestore')

const {
    KNOWLEDGE_CONTRIBUTION_MAX_CHARS,
    KNOWLEDGE_CONTRIBUTION_TITLE_MAX_CHARS,
    buildKnowledgeSourceKey,
    getKnowledgeBasePath,
    getKnowledgeContributionsPath,
} = require('./knowledgeBaseModel')

const CONTRIBUTION_DRAFTS_COLLECTION = 'knowledgeContributionDrafts'
const CONTRIBUTION_DRAFT_TTL_MS = 2 * 60 * 60 * 1000
const CONTRIBUTION_ORIGINS = ['user_statement', 'assistant_summary']
const MAX_LISTED_CONTRIBUTIONS = 50
const SAVE_TOOL = 'save_knowledge_contribution'
const REMOVE_TOOL = 'remove_knowledge_contribution'

// Never on a wiki page (WIKI_RULES says the same to the ingest model): how to reach a person, and
// anything that grants access.
const FORBIDDEN_CONTENT = [
    { kind: 'an email address', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { kind: 'a phone number', pattern: /(?:^|[^\w])(?:\+|00)[1-9][\d\s().\/-]{7,}\d/ },
    {
        kind: 'a password, key or token',
        pattern:
            /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bglpat-[A-Za-z0-9_-]{16,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\b(?:password|passwort|kennwort|contraseña|api[_ -]?key|client[_ -]?secret|access[_ -]?token|secret[_ -]?key)\s*[:=]\s*\S{4,})/i,
    },
]

function failure(error) {
    return { success: false, error }
}

function clip(value, maxChars) {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text
}

// Paragraphs and lists survive; runs of blank lines and trailing spaces do not.
function normalizeContributionText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function titleFromText(text) {
    const firstLine =
        String(text || '')
            .split('\n')
            .find(line => line.trim()) || ''
    const words = firstLine
        .replace(/^[#>*\-\s]+/, '')
        .split(/\s+/)
        .slice(0, 10)
        .join(' ')
    return clip(words, 80) || 'Saved from a conversation'
}

function findForbiddenContent(text) {
    return FORBIDDEN_CONTENT.filter(({ pattern }) => pattern.test(text)).map(({ kind }) => kind)
}

async function loadAuthorName(db, userId) {
    const snapshot = await db.doc(`users/${userId}`).get()
    const user = snapshot.exists ? snapshot.data() || {} : {}
    return String(user.displayName || user.name || '').trim() || 'a project member'
}

async function defaultEnqueue(args) {
    const { enqueueKnowledgeBaseIngest } = require('./knowledgeBaseDispatcher')
    return enqueueKnowledgeBaseIngest(args)
}

/**
 * Why a contribution needs the member to see and confirm its exact text first; [] when it does not.
 * The flags come from the assistant, which knows where the text came from; the project comparison
 * the server makes itself.
 */
function getConfirmationReasons({ origin, mayContainPrivateInformation, projectId, conversationProjectId }) {
    const reasons = []
    if (origin !== 'user_statement') reasons.push('assistant_summary')
    if (mayContainPrivateInformation !== false) reasons.push('may_contain_private_information')
    if (conversationProjectId && conversationProjectId !== projectId) reasons.push('other_project')
    return reasons
}

const CONFIRMATION_REASON_TEXT = {
    assistant_summary: 'it is your summary, not the words the user gave you',
    may_contain_private_information:
        'it may contain something from private tasks, notes, emails or chats, or from the user personally',
    other_project: "it goes into another project's wiki than the one of this conversation",
}

async function deleteExpiredDrafts(db, userId, now) {
    try {
        const snapshot = await db
            .collection(CONTRIBUTION_DRAFTS_COLLECTION)
            .where('userId', '==', userId)
            .limit(20)
            .get()
        const expired = snapshot.docs.filter(doc => !(Number(doc.data()?.expiresAt) > now))
        await Promise.all(expired.map(doc => db.doc(`${CONTRIBUTION_DRAFTS_COLLECTION}/${doc.id}`).delete()))
    } catch (error) {
        console.warn('[knowledge base] Could not clean up expired contribution drafts', { error: error.message })
    }
}

async function storeContribution({
    db,
    projectId,
    userId,
    assistantId,
    title,
    text,
    origin,
    confirmation,
    toolRuntimeContext,
    enqueue,
    now,
    onStored,
}) {
    const knowledgeBaseRef = db.doc(getKnowledgeBasePath(projectId))
    const knowledgeBase = await knowledgeBaseRef.get()
    if (!knowledgeBase.exists || knowledgeBase.data()?.enabled !== true) {
        return failure(
            "The wiki of this project is switched off. A project member can switch it on in the project's wiki settings; then it can be saved."
        )
    }

    const contentHash = crypto.createHash('sha256').update(text).digest('hex')
    const contributionsCollection = db.collection(getKnowledgeContributionsPath(projectId))
    // Asking twice, or a replayed request, must not feed the same text to the wiki twice.
    const duplicates = await contributionsCollection.where('contentHash', '==', contentHash).get()
    const existing = duplicates.docs.find(doc => doc.data()?.status === 'active')
    if (existing) {
        return {
            success: true,
            alreadySaved: true,
            projectId,
            contributionId: existing.id,
            title: existing.data().title,
            note: 'This text is already saved to the wiki; nothing was added again.',
        }
    }

    const contributionId = crypto.randomBytes(10).toString('hex')
    const authorName = await loadAuthorName(db, userId)
    const dueAt = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(knowledgeBaseRef)
        const current = snapshot.exists ? snapshot.data() || {} : null
        if (!current || current.enabled !== true) return null
        transaction.set(db.doc(`${getKnowledgeContributionsPath(projectId)}/${contributionId}`), {
            title,
            text,
            characters: text.length,
            contentHash,
            origin,
            status: 'active',
            addedBy: userId,
            authorName,
            assistantId: assistantId || null,
            // How the member agreed to share it: 'direct' for their own words with nothing private in
            // them, 'confirmed' after they saw the draft, with the reasons it needed confirming.
            confirmation: confirmation.mode,
            confirmationReasons: confirmation.reasons,
            // The conversation it came from, which may belong to another project.
            sourceProjectId: toolRuntimeContext?.projectId || null,
            objectType: toolRuntimeContext?.objectType || null,
            objectId: toolRuntimeContext?.objectId || null,
            messageId: toolRuntimeContext?.messageId || null,
            sourceChannel: toolRuntimeContext?.sourceChannel || null,
            ...(toolRuntimeContext?.sourceChannel === 'mcp'
                ? require('../shared/mcpActor').buildMcpActorMarker(toolRuntimeContext.mcpClient)
                : {}),
            createdAt: now,
            // The ingest's delta reads every source type by lastEditionDate.
            lastEditionDate: now,
        })
        if (onStored) onStored(transaction)
        const nextRunAt = Number(current.nextRunAt)
        if (Number.isFinite(nextRunAt) && nextRunAt <= now) return nextRunAt
        transaction.update(knowledgeBaseRef, { nextRunAt: now })
        return now
    })
    if (dueAt === null) return failure('The wiki of this project was switched off in the meantime.')

    try {
        await enqueue({ projectId, dueAt, trigger: 'contribution' })
    } catch (error) {
        console.warn('[knowledge base] Could not enqueue a run for a contribution; the scheduler will pick it up', {
            projectId,
            contributionId,
            error: error.message,
        })
    }

    return {
        success: true,
        projectId,
        contributionId,
        title,
        note: `Saved. Within the next few minutes the wiki works it into the pages it concerns and cites it as saved by ${authorName}; it stays marked as a member's statement, not a verified record. It can be taken out again with ${REMOVE_TOOL}.`,
    }
}

async function confirmDraft({ db, projectId, userId, assistantId, args, toolRuntimeContext, enqueue, now }) {
    const draftId = String(args.draftId || '').trim()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(draftId)) return failure('Unknown draftId.')
    const draftRef = db.doc(`${CONTRIBUTION_DRAFTS_COLLECTION}/${draftId}`)
    const snapshot = await draftRef.get()
    const draft = snapshot.exists ? snapshot.data() || {} : null
    if (!draft || draft.userId !== userId || draft.projectId !== projectId) {
        return failure('There is no such draft to confirm. Save it again to make a new one.')
    }
    if (!(Number(draft.expiresAt) > now)) {
        await draftRef.delete().catch(() => {})
        return failure('The draft has expired. Save it again to make a new one, and show the user its text.')
    }
    if (args.confirmed !== true) {
        return failure(
            `Pass confirmed: true only after the user has seen the exact text and agreed to share it with every member of the project. Otherwise leave the draft; it expires on its own.`
        )
    }
    const messageId = toolRuntimeContext?.messageId || null
    if (draft.requestMessageId && messageId && draft.requestMessageId === messageId) {
        return failure(
            'The user has not answered yet. Show them the exact text that would be shared, ask whether to save it, and confirm only after their reply.'
        )
    }
    const result = await storeContribution({
        db,
        projectId,
        userId,
        assistantId,
        title: draft.title,
        text: draft.text,
        origin: draft.origin,
        confirmation: { mode: 'confirmed', reasons: draft.reasons || [] },
        toolRuntimeContext,
        enqueue,
        now,
        onStored: transaction => transaction.delete(draftRef),
    })
    if (result.success && result.alreadySaved) await draftRef.delete().catch(() => {})
    return result
}

/**
 * The save_knowledge_contribution tool: stores the text directly when nothing about it is
 * ambiguous, otherwise a draft the member confirms with a second call ({ draftId, confirmed: true }).
 */
async function saveKnowledgeContribution({
    db,
    projectId,
    userId,
    assistantId = null,
    args = {},
    toolRuntimeContext = {},
    enqueue = defaultEnqueue,
    now = Date.now(),
}) {
    if (args.draftId) {
        return confirmDraft({ db, projectId, userId, assistantId, args, toolRuntimeContext, enqueue, now })
    }

    const text = normalizeContributionText(args.text)
    if (!text) return failure(`${SAVE_TOOL} needs the exact text to save.`)
    if (text.length > KNOWLEDGE_CONTRIBUTION_MAX_CHARS) {
        return failure(
            `The text is ${text.length} characters; keep it under ${KNOWLEDGE_CONTRIBUTION_MAX_CHARS}. A file belongs into the wiki through add_knowledge_document.`
        )
    }
    if (!CONTRIBUTION_ORIGINS.includes(args.origin)) {
        return failure(`origin must be one of: ${CONTRIBUTION_ORIGINS.join(', ')}.`)
    }
    if (typeof args.mayContainPrivateInformation !== 'boolean') {
        return failure('mayContainPrivateInformation must be true or false; when you are not sure, it is true.')
    }
    const forbidden = findForbiddenContent(text)
    if (forbidden.length) {
        return failure(
            `The wiki never stores ${forbidden.join(' or ')}. Take ${forbidden.length > 1 ? 'them' : 'it'} out of the text and try again.`
        )
    }
    const title = clip(args.title, KNOWLEDGE_CONTRIBUTION_TITLE_MAX_CHARS) || titleFromText(text)

    const knowledgeBase = await db.doc(getKnowledgeBasePath(projectId)).get()
    if (!knowledgeBase.exists || knowledgeBase.data()?.enabled !== true) {
        return failure(
            "The wiki of this project is switched off. A project member can switch it on in the project's wiki settings; then it can be saved."
        )
    }

    const reasons = getConfirmationReasons({
        origin: args.origin,
        mayContainPrivateInformation: args.mayContainPrivateInformation,
        projectId,
        conversationProjectId: toolRuntimeContext?.projectId || null,
    })
    if (!reasons.length) {
        return storeContribution({
            db,
            projectId,
            userId,
            assistantId,
            title,
            text,
            origin: args.origin,
            confirmation: { mode: 'direct', reasons: [] },
            toolRuntimeContext,
            enqueue,
            now,
        })
    }

    await deleteExpiredDrafts(db, userId, now)
    const draftId = crypto.randomBytes(10).toString('hex')
    await db.doc(`${CONTRIBUTION_DRAFTS_COLLECTION}/${draftId}`).set({
        userId,
        projectId,
        title,
        text,
        origin: args.origin,
        reasons,
        requestMessageId: toolRuntimeContext?.messageId || null,
        createdAt: now,
        expiresAt: now + CONTRIBUTION_DRAFT_TTL_MS,
    })
    return {
        success: true,
        saved: false,
        needsConfirmation: true,
        projectId,
        draftId,
        title,
        textToShare: text,
        reasons,
        note: `NOT saved yet, because ${reasons
            .map(reason => CONFIRMATION_REASON_TEXT[reason])
            .join(
                '; and '
            )}. Show the user this exact text, say that every member of the project will be able to read it in the wiki, and ask whether to save it as it is. If they confirm, call ${SAVE_TOOL} with { draftId: "${draftId}", confirmed: true }. If they want changes, save the changed text again instead. If they decline, do nothing.`,
    }
}

async function removeKnowledgeContribution({
    db,
    projectId,
    userId,
    contributionId,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    const sourceKey = buildKnowledgeSourceKey('contribution', contributionId)
    if (!sourceKey) return failure(`${REMOVE_TOOL} needs the contributionId.`)
    const ref = db.doc(`${getKnowledgeContributionsPath(projectId)}/${contributionId}`)
    const snapshot = await ref.get()
    if (!snapshot.exists) return failure(`There is no saved contribution "${contributionId}" in this wiki.`)
    const contribution = snapshot.data() || {}
    const alreadyRemoved = contribution.status === 'removed'
    // Marked first: a page rebuilt from now on can no longer load it.
    if (!alreadyRemoved) {
        await ref.update({ status: 'removed', removedAt: now, removedBy: userId, text: fieldValue.delete() })
    }
    const { invalidateKnowledgeSource } = require('./knowledgeSourceInvalidation')
    const invalidation = await invalidateKnowledgeSource({
        db,
        projectId,
        sourceKey,
        reason: 'removed',
        now,
        fieldValue,
    })
    return {
        success: true,
        projectId,
        contributionId,
        title: contribution.title || null,
        alreadyRemoved,
        pagesToRebuild: invalidation.pages,
        note: invalidation.pages
            ? `The ${invalidation.pages} wiki page(s) that used it are hidden and rebuilt from their other sources within minutes.`
            : 'No wiki page used it yet.',
    }
}

async function listKnowledgeContributions(db, projectId) {
    const snapshot = await db
        .collection(getKnowledgeContributionsPath(projectId))
        .where('status', '==', 'active')
        .select('title', 'authorName', 'createdAt', 'origin')
        .get()
    return snapshot.docs
        .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
        .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0))
        .slice(0, MAX_LISTED_CONTRIBUTIONS)
        .map(contribution => ({
            contributionId: contribution.id,
            title: contribution.title || contribution.id,
            savedBy: contribution.authorName || '',
            origin: contribution.origin || 'user_statement',
            savedAt: Number.isFinite(contribution.createdAt) ? new Date(contribution.createdAt).toISOString() : null,
        }))
}

module.exports = {
    CONTRIBUTION_DRAFTS_COLLECTION,
    CONTRIBUTION_DRAFT_TTL_MS,
    CONTRIBUTION_ORIGINS,
    findForbiddenContent,
    getConfirmationReasons,
    normalizeContributionText,
    saveKnowledgeContribution,
    removeKnowledgeContribution,
    listKnowledgeContributions,
}
