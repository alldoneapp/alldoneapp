const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')
const { extractPptxText, extractXlsxText, isPptxFile, isXlsxFile } = require('../Utils/officeDocumentText')

const MAX_EXTRACTED_TEXT_PER_FILE = 8000

let pdfParse = null
let mammoth = null

try {
    pdfParse = require('pdf-parse')
} catch (error) {
    console.warn('WhatsApp FileExtraction: pdf-parse not available:', error.message)
}

try {
    mammoth = require('mammoth')
} catch (error) {
    console.warn('WhatsApp FileExtraction: mammoth not available:', error.message)
}

/**
 * Text of a file sent to an assistant (WhatsApp, email, chat uploads, documents added to the
 * project wiki). `maxChars` defaults to the inline budget a conversation carries; the wiki asks for
 * more. `truncated` says the file had more text than was returned.
 */
async function extractTextFromWhatsAppFile({ buffer, contentType, fileName, maxChars = MAX_EXTRACTED_TEXT_PER_FILE }) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { extractedText: '', status: 'no_data' }
    }

    const normalizedContentType = String(contentType || '').toLowerCase()
    const normalizedFileName = String(fileName || '').toLowerCase()
    const result = text => {
        const normalized = String(text || '').trim()
        if (!normalized) return { extractedText: '', status: 'empty_extraction' }
        const truncated = normalized.length > maxChars
        return { extractedText: limitText(normalized, maxChars), status: 'ok', truncated }
    }

    try {
        if (isTextLikeFile(normalizedContentType, normalizedFileName)) {
            return result(buffer.toString('utf8'))
        }

        if (normalizedContentType.includes('application/pdf') || normalizedFileName.endsWith('.pdf')) {
            if (!pdfParse) return { extractedText: '', status: 'parser_unavailable' }
            const parsed = await pdfParse(buffer)
            return result(parsed?.text || '')
        }

        if (isDocx(normalizedContentType, normalizedFileName)) {
            if (!mammoth) return { extractedText: '', status: 'parser_unavailable' }
            const parsed = await mammoth.extractRawText({ buffer })
            return result(parsed?.value || '')
        }

        // One character past the budget is read so that a cut can be told from an exact fit.
        if (isPptxFile(normalizedContentType, normalizedFileName)) {
            return result(await extractPptxText(buffer, { maxChars: maxChars + 1 }))
        }

        if (isXlsxFile(normalizedContentType, normalizedFileName)) {
            return result(await extractXlsxText(buffer, { maxChars: maxChars + 1 }))
        }

        if (normalizedContentType.startsWith('audio/') || normalizedContentType.startsWith('video/')) {
            return result(await transcribeMediaBuffer(buffer, normalizedContentType, normalizedFileName))
        }

        return { extractedText: '', status: 'unsupported' }
    } catch (error) {
        return {
            extractedText: '',
            status: 'error',
            error: error?.message || 'Unknown extraction error',
        }
    }
}

function isTextLikeFile(contentType, fileName) {
    return (
        contentType.startsWith('text/') ||
        contentType.includes('application/json') ||
        contentType.includes('application/csv') ||
        contentType.includes('text/csv') ||
        fileName.endsWith('.txt') ||
        fileName.endsWith('.csv') ||
        fileName.endsWith('.json') ||
        fileName.endsWith('.md')
    )
}

function isDocx(contentType, fileName) {
    return (
        contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
        fileName.endsWith('.docx')
    )
}

async function transcribeMediaBuffer(buffer, contentType, fileName) {
    const envFunctions = getCachedEnvFunctions()
    const openai = getOpenAIClient(envFunctions.OPEN_AI_KEY)
    const extension = getExtensionFromContentType(contentType, fileName)
    const file = new File([buffer], `whatsapp_media.${extension}`, { type: contentType || 'application/octet-stream' })

    const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        response_format: 'verbose_json',
    })

    return String(transcription?.text || '').trim()
}

function getExtensionFromContentType(contentType, fileName) {
    if (fileName && fileName.includes('.')) {
        const parts = fileName.split('.')
        return parts[parts.length - 1] || 'bin'
    }
    if (contentType.includes('mpeg')) return 'mp3'
    if (contentType.includes('mp4')) return 'mp4'
    if (contentType.includes('ogg')) return 'ogg'
    if (contentType.includes('wav')) return 'wav'
    return 'bin'
}

function limitText(text, maxChars = MAX_EXTRACTED_TEXT_PER_FILE) {
    const normalized = String(text || '').trim()
    if (!normalized) return ''
    return normalized.length > maxChars ? `${normalized.substring(0, maxChars)}...` : normalized
}

module.exports = {
    extractTextFromWhatsAppFile,
    MAX_EXTRACTED_TEXT_PER_FILE,
}
