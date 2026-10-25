'use strict'

// The extractor is the real one, reading a real PowerPoint file: "the assistant can put a deck into
// the wiki" is only true if the deck's text survives all the way to the card an ingest run reads.
// Only the OpenAI client it would use for audio is stubbed.
jest.mock('../Assistant/assistantHelper', () => ({ getCachedEnvFunctions: jest.fn(), getOpenAIClient: jest.fn() }))

const fs = require('fs')
const path = require('path')

const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const { addKnowledgeDocument, removeKnowledgeDocument } = require('./knowledgeDocuments')
const { collectKnowledgeSources } = require('./collectKnowledgeSources')
const { extractTextFromWhatsAppFile } = require('../WhatsApp/whatsAppFileExtraction')
const { KNOWLEDGE_DOCUMENT_MAX_CHARS } = require('./knowledgeBaseModel')

const PROJECT_ID = 'project-a'
const NOW = Date.UTC(2026, 9, 25, 9)
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const NIGHTLY = NOW + 18 * 60 * 60 * 1000
const deck = fs.readFileSync(path.join(__dirname, '..', 'Utils', '__fixtures__', 'office', 'pricing-concept.pptx'))

function createDb(knowledgeBase = { enabled: true, ownerUserId: 'member', nextRunAt: NIGHTLY }) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { name: 'Alldone Product', userIds: ['member'] },
        ['users/member']: { displayName: 'Karsten' },
        ...(knowledgeBase ? { [KB_PATH]: knowledgeBase } : {}),
    })
}

const deckAttachment = jest.fn(async () => ({
    fileName: 'pricing-concept.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'file',
    buffer: deck,
    fileSizeBytes: deck.length,
    messageId: 'm1',
}))

function add(db, overrides = {}) {
    return addKnowledgeDocument({
        db,
        projectId: PROJECT_ID,
        userId: 'member',
        assistantId: 'anna',
        args: {},
        toolRuntimeContext: { projectId: 'chat-project', objectType: 'topics', objectId: 'chat-1' },
        readChatAttachment: deckAttachment,
        extractText: extractTextFromWhatsAppFile,
        enqueue: jest.fn(async () => 'enqueued'),
        now: NOW,
        ...overrides,
    })
}

const documentsOf = db =>
    [...db.documents.entries()].filter(([key]) => key.startsWith(`${KB_PATH}/documents/`)).map(([, data]) => data)

beforeEach(() => deckAttachment.mockClear())

describe('addKnowledgeDocument', () => {
    it('stores the text of a deck sent in the conversation and asks the wiki to run now', async () => {
        const db = createDb()
        const enqueue = jest.fn(async () => 'enqueued')
        const result = await add(db, { args: { instructions: 'Nur die Preise übernehmen' }, enqueue })

        expect(result).toMatchObject({
            success: true,
            projectId: PROJECT_ID,
            title: 'pricing-concept',
            truncated: false,
        })
        const stored = db.read(`${KB_PATH}/documents/${result.documentId}`)
        expect(stored).toMatchObject({
            title: 'pricing-concept',
            fileName: 'pricing-concept.pptx',
            status: 'active',
            truncated: false,
            instructions: 'Nur die Preise übernehmen',
            addedBy: 'member',
            authorName: 'Karsten',
            assistantId: 'anna',
            sourceProjectId: 'chat-project',
            objectType: 'topics',
            objectId: 'chat-1',
            messageId: 'm1',
            createdAt: NOW,
            lastEditionDate: NOW,
        })
        expect(stored.text).toContain('Team costs €12 per user & month')
        expect(stored.text).toContain('Speaker notes: Decision pending: annual discount 15% or 20%')
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW)
        expect(enqueue).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW, trigger: 'document' })
    })

    it('reaches the next ingest run as a cited source card', async () => {
        const db = createDb()
        const { documentId } = await add(db, { args: { title: 'Pricing concept 2026' } })

        const { sources } = await collectKnowledgeSources({
            db,
            projectId: PROJECT_ID,
            now: NOW + 1000,
            readNoteContent: async () => '',
            resolveUserNames: async () => ({}),
        })

        expect(sources).toHaveLength(1)
        expect(sources[0]).toMatchObject({ key: `document:${documentId}`, title: 'Pricing concept 2026' })
        expect(sources[0].text).toMatch(
            new RegExp(`^\\[\\[document:${documentId}\\]\\] "Pricing concept 2026" \\(file pricing-concept\\.pptx`)
        )
        expect(sources[0].text).toContain('Slide 4 (hidden)\nBackup: competitor prices')
    })

    it('keeps a run that is already due rather than pushing it back', async () => {
        const db = createDb({ enabled: true, ownerUserId: 'member', nextRunAt: NOW - 5000 })
        const enqueue = jest.fn(async () => 'enqueued')
        await add(db, { enqueue })

        expect(db.read(KB_PATH).nextRunAt).toBe(NOW - 5000)
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ dueAt: NOW - 5000 }))
    })

    it('still adds the document when the immediate run cannot be queued; the scheduler takes it', async () => {
        const db = createDb()
        const result = await add(db, { enqueue: jest.fn(async () => Promise.reject(new Error('queue down'))) })

        expect(result.success).toBe(true)
        expect(documentsOf(db)).toHaveLength(1)
    })

    it('does nothing for a wiki that is switched off or does not exist, not even read the file', async () => {
        for (const knowledgeBase of [{ enabled: false, ownerUserId: 'member' }, null]) {
            const db = createDb(knowledgeBase)
            const result = await add(db)

            expect(result).toMatchObject({ success: false, error: expect.stringMatching(/switched off/) })
            expect(documentsOf(db)).toHaveLength(0)
        }
        expect(deckAttachment).not.toHaveBeenCalled()
    })

    it('passes the message and file name the model chose, and explains how to choose when it fails', async () => {
        const readChatAttachment = jest.fn(async () => {
            throw new Error('No file or image attachment was found on the requested chat message')
        })
        const result = await add(createDb(), {
            readChatAttachment,
            args: { messageId: ' m7 ', fileName: 'deck.pptx' },
        })

        expect(readChatAttachment).toHaveBeenCalledWith({ messageId: 'm7', fileName: 'deck.pptx' })
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/fileName/) })
    })

    it('refuses an image, an old binary format and a file without text, saying why', async () => {
        const image = jest.fn(async () => ({ fileName: 'chart.png', mimeType: 'image/png', kind: 'image' }))
        await expect(add(createDb(), { readChatAttachment: image })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/image/),
        })

        const legacy = jest.fn(async () => ({
            fileName: 'deck.ppt',
            mimeType: 'application/vnd.ms-powerpoint',
            kind: 'file',
            buffer: Buffer.from('legacy'),
        }))
        await expect(add(createDb(), { readChatAttachment: legacy })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/\.pptx/),
        })

        const blank = jest.fn(async () => ({
            fileName: 'empty.txt',
            mimeType: 'text/plain',
            kind: 'file',
            buffer: Buffer.from('  '),
        }))
        const db = createDb()
        await expect(add(db, { readChatAttachment: blank })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/no text/),
        })
        expect(documentsOf(db)).toHaveLength(0)
    })

    it('adds the same file only once, even when asked twice', async () => {
        const db = createDb()
        const first = await add(db)
        const second = await add(db)

        expect(second).toMatchObject({ success: true, alreadyAdded: true, documentId: first.documentId })
        expect(documentsOf(db)).toHaveLength(1)
    })

    it('stores the beginning of a file that is too long and says so', async () => {
        const db = createDb()
        const longText = `${'Kapitel '.repeat(20000)}Ende`
        const file = jest.fn(async () => ({
            fileName: 'handbook.txt',
            mimeType: 'text/plain',
            kind: 'file',
            buffer: Buffer.from(longText),
        }))
        const result = await add(db, { readChatAttachment: file })

        expect(result).toMatchObject({ success: true, truncated: true, characters: KNOWLEDGE_DOCUMENT_MAX_CHARS })
        expect(result.note).toMatch(/only its first 120000 characters/)
        const stored = documentsOf(db)[0]
        expect(stored.text).toHaveLength(KNOWLEDGE_DOCUMENT_MAX_CHARS)
        expect(stored.text.endsWith('...')).toBe(false)
        expect(stored.truncated).toBe(true)
    })

    it('keeps titles and instructions to their limits', async () => {
        const db = createDb()
        const result = await add(db, { args: { title: 'T'.repeat(500), instructions: 'I'.repeat(5000) } })
        const stored = db.read(`${KB_PATH}/documents/${result.documentId}`)

        expect(stored.title.length).toBeLessThanOrEqual(200)
        expect(stored.instructions.length).toBeLessThanOrEqual(1000)
    })
})

describe('removeKnowledgeDocument', () => {
    async function dbWithCitedDocument() {
        const db = createDb()
        const { documentId } = await add(db)
        const key = `document:${documentId}`
        db.write(`${KB_PATH}/pages/preise`, {
            title: 'Preise',
            summary: 'Was es kostet.',
            body: `Team kostet 12 € [[${key}]].`,
            revision: 1,
            sourceKeys: [key],
            historicalSourceKeys: [key],
            sourceLabels: { [key]: 'pricing-concept' },
            archived: false,
            needsRebuild: false,
        })
        db.write(`${KB_PATH}/pages/preise/revisions/000001`, {
            revision: 1,
            body: 'Team kostet 12 €',
            sourceKeys: [key],
        })
        return { db, documentId, key }
    }

    it('deletes what the document said from the document, its pages and their history', async () => {
        const { db, documentId, key } = await dbWithCitedDocument()
        const result = await removeKnowledgeDocument({
            db,
            projectId: PROJECT_ID,
            userId: 'member',
            documentId,
            now: NOW + 1000,
            fieldValue,
        })

        expect(result).toMatchObject({ success: true, alreadyRemoved: false, pagesToRebuild: 1 })
        const document = db.read(`${KB_PATH}/documents/${documentId}`)
        expect(document).toMatchObject({ status: 'removed', removedBy: 'member', removedAt: NOW + 1000 })
        expect(document.text).toBeUndefined()
        expect(document.instructions).toBeUndefined()

        const page = db.read(`${KB_PATH}/pages/preise`)
        expect(page).toMatchObject({ needsRebuild: true, removedSourceKeys: [key], sourceKeys: [] })
        expect(page.body).toBeUndefined()
        expect(db.read(`${KB_PATH}/pages/preise/revisions/000001`)).toMatchObject({ redacted: true })
        expect(db.read(`${KB_PATH}/pages/preise/revisions/000001`).body).toBeUndefined()
        expect(db.read(KB_PATH)).toMatchObject({ rebuildRequestedAt: NOW + 1000 })

        // The rebuild that follows can no longer load it.
        const { loadKnowledgeSourcesByKeys } = require('./collectKnowledgeSources')
        await expect(loadKnowledgeSourcesByKeys({ db, projectId: PROJECT_ID, keys: [key] })).resolves.toEqual([])
    })

    it('can be asked twice, and refuses a document that does not exist', async () => {
        const { db, documentId } = await dbWithCitedDocument()
        const remove = id =>
            removeKnowledgeDocument({
                db,
                projectId: PROJECT_ID,
                userId: 'member',
                documentId: id,
                now: NOW,
                fieldValue,
            })

        await remove(documentId)
        await expect(remove(documentId)).resolves.toMatchObject({
            success: true,
            alreadyRemoved: true,
            pagesToRebuild: 0,
        })
        await expect(remove('missing')).resolves.toMatchObject({ success: false })
        await expect(remove('not a key')).resolves.toMatchObject({ success: false })
    })
})
