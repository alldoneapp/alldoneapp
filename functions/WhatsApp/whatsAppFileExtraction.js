const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')

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

async function extractTextFromWhatsAppFile({ buffer, contentType, fileName }) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { extractedText: '', status: 'no_data' }
    }

    const normalizedContentType = String(contentType || '').toLowerCase()
    const normalizedFileName = String(fileName || '').toLowerCase()

    try {
        if (isTextLikeFile(normalizedContentType, normalizedFileName)) {
            const extractedText = limitText(buffer.toString('utf8'))
            return extractedText ? { extractedText, status: 'ok' } : { extractedText: '', status: 'empty_extraction' }
        }

        if (normalizedContentType.includes('application/pdf') || normalizedFileName.endsWith('.pdf')) {
            if (!pdfParse) return { extractedText: '', status: 'parser_unavailable' }
            const parsed = await pdfParse(buffer)
            const extractedText = limitText(parsed?.text || '')
            return extractedText ? { extractedText, status: 'ok' } : { extractedText: '', status: 'empty_extraction' }
        }

        if (isDocx(normalizedContentType, normalizedFileName)) {
            if (!mammoth) return { extractedText: '', status: 'parser_unavailable' }
            const parsed = await mammoth.extractRawText({ buffer })
            const extractedText = limitText(parsed?.value || '')
            return extractedText ? { extractedText, status: 'ok' } : { extractedText: '', status: 'empty_extraction' }
        }

        if (normalizedContentType.startsWith('audio/') || normalizedContentType.startsWith('video/')) {
            const extractedText = await transcribeMediaBuffer(buffer, normalizedContentType, normalizedFileName)
            return extractedText
                ? { extractedText: limitText(extractedText), status: 'ok' }
                : { extractedText: '', status: 'empty_extraction' }
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

function limitText(text) {
    const normalized = String(text || '').trim()
    if (!normalized) return ''
    return normalized.length > MAX_EXTRACTED_TEXT_PER_FILE
        ? `${normalized.substring(0, MAX_EXTRACTED_TEXT_PER_FILE)}...`
        : normalized
}

module.exports = {
    extractTextFromWhatsAppFile,
    MAX_EXTRACTED_TEXT_PER_FILE,
}
