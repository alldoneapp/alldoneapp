const {
    buildConversationSafeToolResult,
    buildPendingAttachmentPayload,
    injectPendingAttachmentIntoToolArgs,
} = require('./attachmentToolHandoff')

describe('assistant attachment handoff helpers', () => {
    test('redacts attachment base64 from conversation-safe tool results', () => {
        const toolResult = {
            success: true,
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(buildConversationSafeToolResult('get_chat_attachment', toolResult)).toEqual({
            ...toolResult,
            fileBase64: '[omitted from conversation; preserved for the next external tool call]',
            fileBase64Length: toolResult.fileBase64.length,
        })
    })

    test('keeps non-attachment tool results unchanged', () => {
        const toolResult = { success: true, taskId: '123' }

        expect(buildConversationSafeToolResult('create_task', toolResult)).toBe(toolResult)
    })

    test('captures the full attachment payload for the next external tool call', () => {
        const toolResult = {
            success: true,
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
            messageId: 'msg-1',
        }

        expect(buildPendingAttachmentPayload('get_chat_attachment', toolResult)).toEqual({
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
            messageId: 'msg-1',
        })
    })

    test('redacts Gmail attachment base64 while preserving a Gmail source payload for the next tool call', () => {
        const toolResult = {
            success: true,
            fileName: 'invoice-from-gmail.pdf',
            fileBase64: 'Z21haWwtYnl0ZXM=',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 128,
            source: 'gmail',
            messageId: 'gmail-msg-1',
        }

        expect(buildConversationSafeToolResult('get_gmail_attachment', toolResult)).toEqual({
            ...toolResult,
            fileBase64: '[omitted from conversation; preserved for the next external tool call]',
            fileBase64Length: toolResult.fileBase64.length,
        })

        expect(buildPendingAttachmentPayload('get_gmail_attachment', toolResult)).toEqual({
            fileName: 'invoice-from-gmail.pdf',
            fileBase64: 'Z21haWwtYnl0ZXM=',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 128,
            source: 'gmail',
            messageId: 'gmail-msg-1',
        })
    })

    test('injects the pending attachment into external tool arguments when missing', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(
            injectPendingAttachmentIntoToolArgs('external_tool_bookkeeping_send_invoice', {}, pendingAttachmentPayload)
        ).toEqual({
            toolArgs: {
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            },
            usedPendingAttachment: true,
        })
    })

    test('does not override file data already provided by the model', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(
            injectPendingAttachmentIntoToolArgs(
                'external_tool_bookkeeping_send_invoice',
                { fileName: 'custom.pdf', fileBase64: 'ZGVmNDU2' },
                pendingAttachmentPayload
            )
        ).toEqual({
            toolArgs: {
                fileName: 'custom.pdf',
                fileBase64: 'ZGVmNDU2',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            },
            usedPendingAttachment: false,
        })
    })
})
