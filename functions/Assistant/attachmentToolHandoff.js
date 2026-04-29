const REDACTED_FILE_BASE64_PLACEHOLDER = '[omitted from conversation; preserved for the next external tool call]'

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isExternalIntegrationToolName(toolName) {
    return typeof toolName === 'string' && toolName.startsWith('external_tool_')
}

function isGmailDraftToolName(toolName) {
    return ['create_gmail_draft', 'create_gmail_reply_draft', 'update_gmail_draft'].includes(toolName)
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
    if (!isObject(toolArgs)) return toolArgs

    if (isGmailDraftToolName(toolName)) {
        return buildConversationSafeDraftToolArgs(toolArgs, pendingAttachmentPayload)
    }

    if (!isExternalIntegrationToolName(toolName)) return toolArgs

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

function buildConversationSafeDraftToolArgs(toolArgs, pendingAttachmentPayload) {
    const safeToolArgs = { ...toolArgs }
    if (!Array.isArray(safeToolArgs.attachments)) return safeToolArgs

    const pendingFileBase64 = pendingAttachmentPayload?.fileBase64 || ''
    safeToolArgs.attachments = safeToolArgs.attachments.map(attachment => {
        if (!isObject(attachment)) return attachment

        const safeAttachment = { ...attachment }
        const rawBase64 =
            typeof safeAttachment.base64 === 'string'
                ? safeAttachment.base64
                : typeof safeAttachment.fileBase64 === 'string'
                ? safeAttachment.fileBase64
                : ''
        const shouldRedact =
            rawBase64 &&
            (rawBase64 === pendingFileBase64 ||
                rawBase64 === REDACTED_FILE_BASE64_PLACEHOLDER ||
                looksLikeBase64(rawBase64))

        if (shouldRedact) {
            safeAttachment.base64 = REDACTED_FILE_BASE64_PLACEHOLDER
            safeAttachment.base64Length = safeAttachment.base64Length || rawBase64.length
            delete safeAttachment.fileBase64
        }

        return safeAttachment
    })

    return safeToolArgs
}

function looksLikeBase64(value) {
    if (typeof value !== 'string') return false
    const normalized = value.replace(/\s+/g, '')
    if (!normalized || normalized.length % 4 !== 0) return false
    return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
}

function injectPendingAttachmentIntoToolArgs(toolName, toolArgs, pendingAttachmentPayload) {
    if (!pendingAttachmentPayload) {
        return {
            toolArgs,
            usedPendingAttachment: false,
        }
    }

    if (isGmailDraftToolName(toolName)) {
        return injectPendingAttachmentIntoDraftToolArgs(toolArgs, pendingAttachmentPayload)
    }

    if (!isExternalIntegrationToolName(toolName)) {
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

function buildDraftAttachmentFromPendingPayload(pendingAttachmentPayload) {
    return {
        fileName: pendingAttachmentPayload.fileName || '',
        mimeType: pendingAttachmentPayload.fileMimeType || '',
        base64: pendingAttachmentPayload.fileBase64 || '',
    }
}

function shouldFillDraftAttachmentBase64(attachment, pendingAttachmentPayload) {
    if (!isObject(attachment)) return false

    const rawBase64 =
        typeof attachment.base64 === 'string'
            ? attachment.base64
            : typeof attachment.fileBase64 === 'string'
            ? attachment.fileBase64
            : ''

    return (
        !rawBase64.trim() ||
        rawBase64 === REDACTED_FILE_BASE64_PLACEHOLDER ||
        !looksLikeBase64(rawBase64) ||
        rawBase64.length !== pendingAttachmentPayload.fileBase64.length
    )
}

function injectPendingAttachmentIntoDraftToolArgs(toolArgs, pendingAttachmentPayload) {
    const normalizedArgs = isObject(toolArgs) ? { ...toolArgs } : {}
    const pendingAttachment = buildDraftAttachmentFromPendingPayload(pendingAttachmentPayload)
    const attachments = Array.isArray(normalizedArgs.attachments) ? [...normalizedArgs.attachments] : []
    let usedPendingAttachment = false

    if (attachments.length === 0) {
        normalizedArgs.attachments = [pendingAttachment]
        return {
            toolArgs: normalizedArgs,
            usedPendingAttachment: true,
        }
    }

    normalizedArgs.attachments = attachments.map((attachment, index) => {
        if (usedPendingAttachment || !shouldFillDraftAttachmentBase64(attachment, pendingAttachmentPayload)) {
            return attachment
        }

        usedPendingAttachment = true
        return {
            ...attachment,
            fileName: attachment.fileName || attachment.name || pendingAttachment.fileName,
            mimeType: attachment.mimeType || attachment.fileMimeType || pendingAttachment.mimeType,
            base64: pendingAttachment.base64,
        }
    })

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
