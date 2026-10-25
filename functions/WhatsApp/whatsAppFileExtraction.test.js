'use strict'

// Only the OpenAI client used for audio is stubbed; the Office parsing is real and reads the files
// in Utils/__fixtures__/office.
jest.mock('../Assistant/assistantHelper', () => ({ getCachedEnvFunctions: jest.fn(), getOpenAIClient: jest.fn() }))

const fs = require('fs')
const path = require('path')

const { MAX_EXTRACTED_TEXT_PER_FILE, extractTextFromWhatsAppFile } = require('./whatsAppFileExtraction')

const fixture = name => fs.readFileSync(path.join(__dirname, '..', 'Utils', '__fixtures__', 'office', name))

describe('extractTextFromWhatsAppFile', () => {
    it('reads PowerPoint and Excel files, by MIME type or by extension', async () => {
        const deck = await extractTextFromWhatsAppFile({
            buffer: fixture('pricing-concept.pptx'),
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            fileName: 'upload',
        })
        expect(deck).toMatchObject({ status: 'ok', truncated: false })
        expect(deck.extractedText).toContain('Team costs €12 per user & month')

        const sheet = await extractTextFromWhatsAppFile({
            buffer: fixture('price-list.xlsx'),
            contentType: 'application/octet-stream',
            fileName: 'price-list.xlsx',
        })
        expect(sheet.extractedText).toContain('Team | 12 | 2026-03-15')
    })

    it('keeps the inline budget by default and says when it cut a file', async () => {
        const text = 'x'.repeat(MAX_EXTRACTED_TEXT_PER_FILE + 10)
        const result = await extractTextFromWhatsAppFile({ buffer: Buffer.from(text), fileName: 'long.txt' })

        expect(result).toMatchObject({ status: 'ok', truncated: true })
        expect(result.extractedText).toBe(`${'x'.repeat(MAX_EXTRACTED_TEXT_PER_FILE)}...`)
    })

    it('reads further when asked, and tells a cut from an exact fit for a deck too', async () => {
        const deck = fixture('pricing-concept.pptx')
        const full = await extractTextFromWhatsAppFile({ buffer: deck, fileName: 'deck.pptx', maxChars: 100000 })
        const exact = await extractTextFromWhatsAppFile({
            buffer: deck,
            fileName: 'deck.pptx',
            maxChars: full.extractedText.length,
        })
        const short = await extractTextFromWhatsAppFile({ buffer: deck, fileName: 'deck.pptx', maxChars: 50 })

        expect(full.truncated).toBe(false)
        expect(exact).toMatchObject({ truncated: false, extractedText: full.extractedText })
        expect(short.truncated).toBe(true)
        expect(short.extractedText).toBe(`${full.extractedText.slice(0, 50)}...`)
    })

    it('reports a broken Office file and an old binary format instead of throwing', async () => {
        await expect(
            extractTextFromWhatsAppFile({ buffer: Buffer.from('not a zip'), fileName: 'deck.pptx' })
        ).resolves.toMatchObject({ status: 'error', extractedText: '' })
        await expect(
            extractTextFromWhatsAppFile({
                buffer: Buffer.from('binary'),
                contentType: 'application/vnd.ms-powerpoint',
                fileName: 'deck.ppt',
            })
        ).resolves.toEqual({ extractedText: '', status: 'unsupported' })
    })
})
