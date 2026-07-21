const REDACTED_FILE_BASE64_PLACEHOLDER = '[omitted from conversation; preserved for the next external tool call]'
const MAX_TOOL_RESULT_CONTEXT_CHARS = 40000
const GLOBAL_TOOL_RESULT_MAX_STRING_LENGTH = 2000
const GLOBAL_TOOL_RESULT_MAX_ARRAY_ITEMS = 20
const GLOBAL_TOOL_RESULT_MAX_OBJECT_KEYS = 50

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

function buildConversationSafeCalendarAvailabilityResult(toolResult) {
    const result = isObject(toolResult) ? toolResult : {}
    const safeResult = {
        success: result.success === true,
        options: Array.isArray(result.options)
            ? result.options
                  .map(option => ({
                      start: typeof option?.start === 'string' ? option.start : '',
                      end: typeof option?.end === 'string' ? option.end : '',
                  }))
                  .filter(option => option.start && option.end)
            : [],
        message: typeof result.message === 'string' ? result.message : '',
    }

    if (typeof result.timeZone === 'string') safeResult.timeZone = result.timeZone
    if (Number.isFinite(result.durationMinutes)) safeResult.durationMinutes = result.durationMinutes
    if (isObject(result.requestedRange)) {
        safeResult.requestedRange = {
            start: typeof result.requestedRange.start === 'string' ? result.requestedRange.start : '',
            end: typeof result.requestedRange.end === 'string' ? result.requestedRange.end : '',
        }
    }
    if (isObject(result.workingHours)) {
        safeResult.workingHours = {
            start: typeof result.workingHours.start === 'string' ? result.workingHours.start : '',
            end: typeof result.workingHours.end === 'string' ? result.workingHours.end : '',
            includeWeekends: result.workingHours.includeWeekends === true,
        }
    }

    return safeResult
}

// The conversation-safe version of a tool result is what gets re-sent to the model on EVERY
// subsequent tool-loop round. For `search` the raw result carries full per-item bodies (note
// content, task comment threads, long descriptions) that compound the context and make each
// additional step slower than the last. We keep ids/names/dates (short fields) so the model can
// still pick a result and fetch the full record by id, but trim the bulk.
const SEARCH_RESULT_MAX_ITEMS_PER_CATEGORY = 10
const SEARCH_RESULT_MAX_STRING_LENGTH = 500

function truncateForContext(value, depth = 0) {
    if (typeof value === 'string') {
        if (value.length <= SEARCH_RESULT_MAX_STRING_LENGTH) return value
        return `${value.slice(0, SEARCH_RESULT_MAX_STRING_LENGTH)}… [truncated ${
            value.length - SEARCH_RESULT_MAX_STRING_LENGTH
        } chars]`
    }
    if (Array.isArray(value)) {
        if (depth >= 5) return '[…]'
        return value.map(item => truncateForContext(item, depth + 1))
    }
    if (isObject(value)) {
        if (depth >= 7) return {}
        const out = {}
        for (const [key, val] of Object.entries(value)) {
            out[key] = truncateForContext(val, depth + 1)
        }
        return out
    }
    return value
}

function buildConversationSafeSearchResult(toolResult) {
    if (!isObject(toolResult) || !isObject(toolResult.results)) return toolResult

    const trimmedResults = {}
    let omittedItems = 0
    for (const [category, items] of Object.entries(toolResult.results)) {
        if (!Array.isArray(items)) {
            trimmedResults[category] = truncateForContext(items)
            continue
        }
        const kept = items.slice(0, SEARCH_RESULT_MAX_ITEMS_PER_CATEGORY)
        omittedItems += items.length - kept.length
        trimmedResults[category] = kept.map(item => truncateForContext(item))
    }

    return {
        ...toolResult,
        results: trimmedResults,
        // `totalResults`/`summary` already convey the true totals, so the model still knows the
        // full picture even when individual items were trimmed for context size.
        ...(omittedItems > 0 ? { omittedFromContext: omittedItems } : {}),
        contextTrimmed: true,
    }
}

function truncateToolResultForGlobalCeiling(value, depth = 0) {
    if (typeof value === 'string') {
        if (value.length <= GLOBAL_TOOL_RESULT_MAX_STRING_LENGTH) return value
        return `${value.slice(0, GLOBAL_TOOL_RESULT_MAX_STRING_LENGTH)}… [truncated ${
            value.length - GLOBAL_TOOL_RESULT_MAX_STRING_LENGTH
        } chars]`
    }
    if (Array.isArray(value)) {
        if (depth >= 7) return [`[${value.length} item(s) omitted at maximum depth]`]
        const items = value
            .slice(0, GLOBAL_TOOL_RESULT_MAX_ARRAY_ITEMS)
            .map(item => truncateToolResultForGlobalCeiling(item, depth + 1))
        if (value.length > items.length) {
            items.push(`[${value.length - items.length} additional item(s) omitted]`)
        }
        return items
    }
    if (isObject(value)) {
        if (depth >= 9) return { contextOmittedAtMaximumDepth: true }
        const entries = Object.entries(value)
        const out = {}
        entries.slice(0, GLOBAL_TOOL_RESULT_MAX_OBJECT_KEYS).forEach(([key, item]) => {
            out[key] = truncateToolResultForGlobalCeiling(item, depth + 1)
        })
        if (entries.length > GLOBAL_TOOL_RESULT_MAX_OBJECT_KEYS) {
            out.contextOmittedObjectKeys = entries.length - GLOBAL_TOOL_RESULT_MAX_OBJECT_KEYS
        }
        return out
    }
    return value
}

function enforceToolResultContextCeiling(toolName, toolResult) {
    let serialized
    try {
        serialized = JSON.stringify(toolResult)
    } catch (error) {
        serialized = String(toolResult)
    }
    const originalCharacterCount = typeof serialized === 'string' ? serialized.length : 0
    if (originalCharacterCount <= MAX_TOOL_RESULT_CONTEXT_CHARS) return toolResult

    console.warn('🚨 OPENAI TOOL RESULT CEILING: Truncated oversized result', {
        toolName,
        originalCharacterCount,
        maxCharacters: MAX_TOOL_RESULT_CONTEXT_CHARS,
    })

    const compactResult = truncateToolResultForGlobalCeiling(toolResult)
    const compactWithMetadata = isObject(compactResult)
        ? {
              ...compactResult,
              contextTruncated: true,
              originalCharacterCount,
              maxContextCharacters: MAX_TOOL_RESULT_CONTEXT_CHARS,
          }
        : {
              result: compactResult,
              contextTruncated: true,
              originalCharacterCount,
              maxContextCharacters: MAX_TOOL_RESULT_CONTEXT_CHARS,
          }

    let compactSerialized
    try {
        compactSerialized = JSON.stringify(compactWithMetadata)
    } catch (error) {
        compactSerialized = ''
    }
    if (compactSerialized.length <= MAX_TOOL_RESULT_CONTEXT_CHARS) return compactWithMetadata

    const fallback = {
        contextTruncated: true,
        toolName,
        originalCharacterCount,
        maxContextCharacters: MAX_TOOL_RESULT_CONTEXT_CHARS,
        message:
            'The tool result exceeded the conversation context ceiling. Narrow the query or fetch one record by ID.',
        serializedPreview: '',
    }
    const fixedLength = JSON.stringify(fallback).length
    fallback.serializedPreview = serialized.slice(0, Math.max(0, MAX_TOOL_RESULT_CONTEXT_CHARS - fixedLength - 32))
    let fallbackLength = JSON.stringify(fallback).length
    while (fallbackLength > MAX_TOOL_RESULT_CONTEXT_CHARS && fallback.serializedPreview.length > 0) {
        fallback.serializedPreview = fallback.serializedPreview.slice(
            0,
            Math.max(0, fallback.serializedPreview.length - (fallbackLength - MAX_TOOL_RESULT_CONTEXT_CHARS) - 16)
        )
        fallbackLength = JSON.stringify(fallback).length
    }
    return fallback
}

function buildConversationSafeToolResult(toolName, toolResult) {
    let safeToolResult = toolResult
    if (toolName === 'find_calendar_availability') {
        safeToolResult = buildConversationSafeCalendarAvailabilityResult(toolResult)
    } else if (toolName === 'search') {
        safeToolResult = buildConversationSafeSearchResult(toolResult)
    } else if (isSuccessfulAttachmentToolResult(toolName, toolResult)) {
        safeToolResult = {
            ...toolResult,
            fileBase64: REDACTED_FILE_BASE64_PLACEHOLDER,
            fileBase64Length: toolResult.fileBase64.length,
        }
    }

    return enforceToolResultContextCeiling(toolName, safeToolResult)
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
    MAX_TOOL_RESULT_CONTEXT_CHARS,
    buildConversationSafeToolResult,
    buildPendingAttachmentPayload,
    buildConversationSafeToolArgs,
    injectPendingAttachmentIntoToolArgs,
}
