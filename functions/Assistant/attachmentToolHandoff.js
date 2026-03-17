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
        fileBase64: '[omitted from conversation; preserved for the next external tool call]',
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

function injectPendingAttachmentIntoToolArgs(toolName, toolArgs, pendingAttachmentPayload) {
    if (!isExternalIntegrationToolName(toolName) || !pendingAttachmentPayload) {
        return {
            toolArgs,
            usedPendingAttachment: false,
        }
    }

    const normalizedArgs = isObject(toolArgs) ? { ...toolArgs } : {}
    let usedPendingAttachment = false

    if (typeof normalizedArgs.fileBase64 !== 'string' || !normalizedArgs.fileBase64.trim()) {
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
    injectPendingAttachmentIntoToolArgs,
}
