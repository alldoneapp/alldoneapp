'use strict'

// Documents a member adds to the project wiki: "put this deck into the wiki". The file is one the
// member sent in their conversation with an assistant; its text is extracted on the server and
// stored at knowledgeBases/{projectId}/documents/{id}, and the next ingest run (asked for right
// away) folds it into the pages like any other source, cited as [[document:ID]].
//
// Why a source of its own rather than a note: a note would sit in every notes list, notify
// followers and go through the Updates feed, while what the member asked for is that the wiki
// TAKES IN what the document says — integrated into the pages it concerns, not parked next to them.
// Like a correction, a document lives inside the wiki tree and so shares its audience (the project's
// members) by construction; adding one is the member's decision to share what it says with them.
//
// Removing a document goes through the same invalidation as an object that turned private: every
// page that cited it is emptied, hidden and rebuilt from its other sources, its revisions are
// redacted, and the stored text is deleted, because members can read the whole tree.

const crypto = require('crypto')
const { FieldValue } = require('firebase-admin/firestore')

const {
    KNOWLEDGE_DOCUMENT_INSTRUCTIONS_MAX_CHARS,
    KNOWLEDGE_DOCUMENT_MAX_CHARS,
    KNOWLEDGE_DOCUMENT_TITLE_MAX_CHARS,
    buildKnowledgeSourceKey,
    getKnowledgeBasePath,
    getKnowledgeDocumentsPath,
} = require('./knowledgeBaseModel')

const SUPPORTED_FILE_TYPES = 'PowerPoint (.pptx), Excel (.xlsx), Word (.docx), PDF, text, Markdown, CSV or JSON'
const MAX_LISTED_DOCUMENTS = 50

function failure(error) {
    return { success: false, error }
}

function defaultExtractText(args) {
    return require('../WhatsApp/whatsAppFileExtraction').extractTextFromWhatsAppFile(args)
}

// The scheduler picks a due run up within 15 minutes; this only saves the wait.
async function defaultEnqueue(args) {
    const { enqueueKnowledgeBaseIngest } = require('./knowledgeBaseDispatcher')
    return enqueueKnowledgeBaseIngest(args)
}

function clip(value, maxChars) {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text
}

function titleFromFileName(fileName) {
    return String(fileName || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'Document'
}

async function loadAuthorName(db, userId) {
    const snapshot = await db.doc(`users/${userId}`).get()
    const user = snapshot.exists ? snapshot.data() || {} : {}
    return String(user.displayName || user.name || '').trim() || 'a project member'
}

function describeExtractionFailure(fileName, extraction) {
    switch (extraction?.status) {
        case 'unsupported':
            return `The wiki cannot read "${fileName}". It reads ${SUPPORTED_FILE_TYPES}; an older .ppt or .xls file has to be saved in the newer format first.`
        case 'empty_extraction':
        case 'no_data':
            return `"${fileName}" contains no text the wiki could read, for example a scanned PDF or a deck made of pictures.`
        default:
            return `"${fileName}" could not be read${extraction?.error ? `: ${extraction.error}` : ''}.`
    }
}

async function addKnowledgeDocument({
    db,
    projectId,
    userId,
    assistantId = null,
    args = {},
    toolRuntimeContext = {},
    readChatAttachment,
    extractText = defaultExtractText,
    enqueue = defaultEnqueue,
    now = Date.now(),
}) {
    if (typeof readChatAttachment !== 'function') {
        return failure('A document can only be added from the conversation it was sent in.')
    }
    const knowledgeBaseRef = db.doc(getKnowledgeBasePath(projectId))
    const knowledgeBase = await knowledgeBaseRef.get()
    if (!knowledgeBase.exists || knowledgeBase.data()?.enabled !== true) {
        return failure(
            "The wiki of this project is switched off. A project member can switch it on in the project's wiki settings; then the document can be added."
        )
    }

    let file
    try {
        file = await readChatAttachment({
            messageId: typeof args.messageId === 'string' ? args.messageId.trim() : '',
            fileName: typeof args.fileName === 'string' ? args.fileName.trim() : '',
        })
    } catch (error) {
        return failure(
            `Could not tell which file to add (${error.message}). Pass fileName as it appears in the conversation, or the messageId from list_recent_chat_media.`
        )
    }
    if (file.kind === 'image') {
        return failure(`"${file.fileName}" is an image; the wiki can only take in documents: ${SUPPORTED_FILE_TYPES}.`)
    }

    const extraction = await extractText({
        buffer: file.buffer,
        contentType: file.mimeType,
        fileName: file.fileName,
        maxChars: KNOWLEDGE_DOCUMENT_MAX_CHARS,
    })
    const text = String(extraction?.extractedText || '').trim()
    if (extraction?.status !== 'ok' || !text) return failure(describeExtractionFailure(file.fileName, extraction))

    const documentsCollection = db.collection(getKnowledgeDocumentsPath(projectId))
    const contentHash = crypto.createHash('sha256').update(text).digest('hex')
    // Asking twice, or a replayed request, must not feed the same text to the wiki twice.
    const duplicates = await documentsCollection.where('contentHash', '==', contentHash).get()
    const existing = duplicates.docs.find(doc => doc.data()?.status === 'active')
    if (existing) {
        return {
            success: true,
            alreadyAdded: true,
            projectId,
            documentId: existing.id,
            title: existing.data().title,
            note: 'This document is already in the wiki; nothing was added again.',
        }
    }

    const documentId = crypto.randomBytes(10).toString('hex')
    const title = clip(args.title, KNOWLEDGE_DOCUMENT_TITLE_MAX_CHARS) || clip(titleFromFileName(file.fileName), 200)
    const instructions = clip(args.instructions, KNOWLEDGE_DOCUMENT_INSTRUCTIONS_MAX_CHARS)
    const authorName = await loadAuthorName(db, userId)
    const truncated = extraction.truncated === true
    const storedText = truncated ? text.replace(/\.\.\.$/, '') : text

    const dueAt = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(knowledgeBaseRef)
        const current = snapshot.exists ? snapshot.data() || {} : null
        if (!current || current.enabled !== true) return null
        transaction.set(db.doc(`${getKnowledgeDocumentsPath(projectId)}/${documentId}`), {
            title,
            fileName: clip(file.fileName, 300),
            mimeType: file.mimeType || null,
            fileSizeBytes: Number(file.fileSizeBytes) || null,
            text: storedText,
            characters: storedText.length,
            truncated,
            contentHash,
            instructions,
            status: 'active',
            addedBy: userId,
            authorName,
            assistantId: assistantId || null,
            // The conversation the file was sent in, which may belong to another project.
            sourceProjectId: toolRuntimeContext?.projectId || null,
            objectType: toolRuntimeContext?.objectType || null,
            objectId: toolRuntimeContext?.objectId || null,
            messageId: file.messageId || null,
            createdAt: now,
            // The ingest's delta reads every source type by lastEditionDate.
            lastEditionDate: now,
        })
        const nextRunAt = Number(current.nextRunAt)
        if (Number.isFinite(nextRunAt) && nextRunAt <= now) return nextRunAt
        transaction.update(knowledgeBaseRef, { nextRunAt: now })
        return now
    })
    if (dueAt === null) return failure('The wiki of this project was switched off in the meantime.')

    try {
        await enqueue({ projectId, dueAt, trigger: 'document' })
    } catch (error) {
        console.warn('[knowledge base] Could not enqueue a run for a new document; the scheduler will pick it up', {
            projectId,
            documentId,
            error: error.message,
        })
    }

    return {
        success: true,
        projectId,
        documentId,
        title,
        fileName: file.fileName,
        characters: storedText.length,
        truncated,
        note: `The wiki takes the document in within the next few minutes and cites it on the pages it changes.${
            truncated ? ` The file is long: only its first ${KNOWLEDGE_DOCUMENT_MAX_CHARS} characters were added.` : ''
        } It can be taken out again with remove_knowledge_document.`,
    }
}

async function removeKnowledgeDocument({
    db,
    projectId,
    userId,
    documentId,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    const sourceKey = buildKnowledgeSourceKey('document', documentId)
    if (!sourceKey) return failure('remove_knowledge_document needs the documentId.')
    const documentRef = db.doc(`${getKnowledgeDocumentsPath(projectId)}/${documentId}`)
    const snapshot = await documentRef.get()
    if (!snapshot.exists) return failure(`There is no document "${documentId}" in this wiki.`)
    const document = snapshot.data() || {}
    const alreadyRemoved = document.status === 'removed'

    // Marked first: a page rebuilt from now on can no longer load the document, so the rebuild that
    // the invalidation schedules cannot bring it back.
    if (!alreadyRemoved) {
        await documentRef.update({
            status: 'removed',
            removedAt: now,
            removedBy: userId,
            text: fieldValue.delete(),
            instructions: fieldValue.delete(),
        })
    }
    // Run again for an already removed document too: it is cheap when nothing cites it, and it
    // finishes a removal whose invalidation failed half-way.
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
        documentId,
        title: document.title || null,
        alreadyRemoved,
        pagesToRebuild: invalidation.pages,
        note: invalidation.pages
            ? `The ${invalidation.pages} wiki page(s) that used it are hidden and rebuilt from their other sources within minutes.`
            : 'No wiki page used it yet.',
    }
}

async function listKnowledgeDocuments(db, projectId) {
    const snapshot = await db
        .collection(getKnowledgeDocumentsPath(projectId))
        .where('status', '==', 'active')
        .select('title', 'fileName', 'authorName', 'createdAt', 'characters')
        .get()
    return snapshot.docs
        .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
        .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0))
        .slice(0, MAX_LISTED_DOCUMENTS)
        .map(document => ({
            documentId: document.id,
            title: document.title || document.fileName || document.id,
            fileName: document.fileName || '',
            addedBy: document.authorName || '',
            addedAt: Number.isFinite(document.createdAt) ? new Date(document.createdAt).toISOString() : null,
        }))
}

module.exports = {
    SUPPORTED_FILE_TYPES,
    addKnowledgeDocument,
    removeKnowledgeDocument,
    listKnowledgeDocuments,
}
