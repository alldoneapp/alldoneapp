'use strict'

// The text an artifact contributes to the project wiki: what its current entry file says.
//
// Only the entry file of the current version is read, because that is what a member sees when they
// open the artifact; the other files of a web bundle are scripts, styles and images. Text kinds are
// read as they are (an HTML page as its visible text), PDF, Word, PowerPoint and Excel through the
// same extraction the assistant uses for an upload. Images, audio and video contribute nothing:
// transcribing a recording would cost money on every edit of an artifact nobody asked to transcribe.
//
// Never throws. An artifact whose file cannot be read still contributes its title and description.

const {
    ARTIFACT_KINDS,
    getArtifactFileStoragePath,
    getMimeTypeForPath,
    isTextMimeType,
} = require('../Artifacts/artifactModel')

// A text file larger than this is not prose a wiki page could use; it is data or a bundle.
const MAX_TEXT_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_DOCUMENT_SOURCE_BYTES = 15 * 1024 * 1024
const OFFICE_DOCUMENT_PATTERN = /\.(pdf|docx|pptx|xlsx)$/i

function isWebEntry(artifact) {
    return artifact.kind === ARTIFACT_KINDS.WEB || /\.x?html?$/i.test(String(artifact.entryPath || ''))
}

function normalizeExtractedText(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function describeEntryFile(artifact) {
    const entryPath = String(artifact?.entryPath || '')
    const mimeType = getMimeTypeForPath(entryPath)
    if (!artifact?.currentVersionId || !entryPath) return null
    // An SVG is an image that happens to be XML.
    if (isTextMimeType(mimeType) && mimeType !== 'image/svg+xml') return { entryPath, mimeType, kind: 'text' }
    if (OFFICE_DOCUMENT_PATTERN.test(entryPath)) return { entryPath, mimeType, kind: 'document' }
    return null
}

async function readArtifactText({ bucket, projectId, artifactId, artifact, maxChars, extractDocumentText }) {
    const entry = describeEntryFile(artifact)
    if (!entry) return ''
    try {
        const file = bucket.file(
            getArtifactFileStoragePath(projectId, artifactId, artifact.currentVersionId, entry.entryPath)
        )
        const [metadata] = await file.getMetadata()
        const limit = entry.kind === 'text' ? MAX_TEXT_SOURCE_BYTES : MAX_DOCUMENT_SOURCE_BYTES
        if (Number(metadata?.size) > limit) return ''
        const [bytes] = await file.download()

        if (entry.kind === 'text') {
            const raw = bytes.toString('utf8')
            const { htmlToText } = require('../Artifacts/artifactSearch')
            return normalizeExtractedText(isWebEntry(artifact) ? htmlToText(raw) : raw).slice(0, maxChars)
        }

        const extract = extractDocumentText || require('../WhatsApp/whatsAppFileExtraction').extractTextFromWhatsAppFile
        const { extractedText } = await extract({
            buffer: bytes,
            contentType: entry.mimeType,
            fileName: entry.entryPath,
            maxChars,
        })
        return normalizeExtractedText(extractedText).slice(0, maxChars)
    } catch (error) {
        console.warn('[knowledge base] Could not read the artifact entry file', {
            projectId,
            artifactId,
            error: error.message,
        })
        return ''
    }
}

module.exports = {
    describeEntryFile,
    readArtifactText,
}
