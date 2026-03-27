const REDACTED_FILE_BASE64_PLACEHOLDER = '[omitted from conversation; preserved for the next external tool call]'

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isExternalIntegrationToolName(toolName) {
    return typeof toolName === 'string' && toolName.startsWith('external_tool_')
}

function isSuccessfulAttachmentToolResult(toolName, toolResult) {
    if (!['get_chat_attachment', 'get_gmail_attachment'].includes(toolName)) return false
    return !!(toolResult?.success && typeof toolResult?.fileBase64 === 'string' && toolResult.fileBase64.trim())
}

function buildConversationSafeToolResult(toolName, toolResult) {
    if (!isSuccessfulAttachmentToolResult(toolName, toolResult)) return toolResult

    return {
        ...toolResult,
        fileBase64: REDACTED_FILE_BASE64_PLACEHOLDER,
        fileBase64Length: toolResult.fileBase64.length,
    }
}

function buildPendingAttachmentPayload(toolName, toolResult) {
    if (!isSuccessfulAttachmentToolResult(toolName, toolResult)) return null

    return {
        fileName: toolResult.fileName || '',
        fileBase64: toolResult.fileBase64 || '',
        fileMimeType: toolResult.fileMimeType || '',
        fileSizeBytes: toolResult.fileSizeBytes || 0,
        source: toolResult.source || (toolName === 'get_gmail_attachment' ? 'gmail' : 'chat'),
        messageId: toolResult.messageId || '',
    }
}

function buildConversationSafeToolArgs(toolName, toolArgs, pendingAttachmentPayload) {
    if (!isExternalIntegrationToolName(toolName) || !isObject(toolArgs)) return toolArgs

    const safeToolArgs = { ...toolArgs }
    const pendingFileBase64 = pendingAttachmentPayload?.fileBase64 || ''

    if (typeof safeToolArgs.fileBase64 === 'string' && safeToolArgs.fileBase64.trim()) {
        const shouldRedact =
            safeToolArgs.fileBase64 === pendingFileBase64 ||
            safeToolArgs.fileBase64 === REDACTED_FILE_BASE64_PLACEHOLDER ||
            looksLikeBase64(safeToolArgs.fileBase64)

        if (shouldRedact) {
            safeToolArgs.fileBase64 = REDACTED_FILE_BASE64_PLACEHOLDER
            safeToolArgs.fileBase64Length = safeToolArgs.fileBase64Length || toolArgs.fileBase64.length
        }
    }

    return safeToolArgs
}

function looksLikeBase64(value) {
    if (typeof value !== 'string') return false
    const normalized = value.replace(/\s+/g, '')
    if (!normalized || normalized.length % 4 !== 0) return false
    return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
}

function injectPendingAttachmentIntoToolArgs(toolName, toolArgs, pendingAttachmentPayload) {
    if (!isExternalIntegrationToolName(toolName) || !pendingAttachmentPayload) {
        return {
            toolArgs,
            usedPendingAttachment: false,
        }
    }

    const normalizedArgs = isObject(toolArgs) ? { ...toolArgs } : {}
    let usedPendingAttachment = false
    const shouldReplaceFileBase64 =
        typeof normalizedArgs.fileBase64 !== 'string' ||
        !normalizedArgs.fileBase64.trim() ||
        normalizedArgs.fileBase64 === REDACTED_FILE_BASE64_PLACEHOLDER ||
        !looksLikeBase64(normalizedArgs.fileBase64) ||
        normalizedArgs.fileBase64.length !== pendingAttachmentPayload.fileBase64.length

    if (shouldReplaceFileBase64) {
        normalizedArgs.fileBase64 = pendingAttachmentPayload.fileBase64
        usedPendingAttachment = true
    }
    if (typeof normalizedArgs.fileName !== 'string' || !normalizedArgs.fileName.trim()) {
        normalizedArgs.fileName = pendingAttachmentPayload.fileName
        usedPendingAttachment = true
    }
    if (typeof normalizedArgs.fileMimeType !== 'string' || !normalizedArgs.fileMimeType.trim()) {
        normalizedArgs.fileMimeType = pendingAttachmentPayload.fileMimeType
    }
    if (
        !Number.isFinite(Number(normalizedArgs.fileSizeBytes)) &&
        Number.isFinite(Number(pendingAttachmentPayload.fileSizeBytes))
    ) {
        normalizedArgs.fileSizeBytes = pendingAttachmentPayload.fileSizeBytes
    }
    if (typeof normalizedArgs.source !== 'string' || !normalizedArgs.source.trim()) {
        normalizedArgs.source = pendingAttachmentPayload.source
    }

    return {
        toolArgs: normalizedArgs,
        usedPendingAttachment,
    }
}

module.exports = {
    buildConversationSafeToolResult,
    buildPendingAttachmentPayload,
    buildConversationSafeToolArgs,
    injectPendingAttachmentIntoToolArgs,
}
