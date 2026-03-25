'use strict'

jest.mock('firebase-admin', () => {
    const auditSet = jest.fn().mockResolvedValue(undefined)
    return {
        firestore: Object.assign(
            jest.fn(() => ({
                doc: jest.fn(() => ({
                    set: auditSet,
                })),
            })),
            {
                FieldValue: {
                    increment: jest.fn(value => value),
                },
            }
        ),
        storage: jest.fn(() => ({
            bucket: jest.fn(() => ({
                file: jest.fn(storagePath => ({
                    download: jest.fn().mockImplementation(async () => {
                        if (storagePath.includes('invoice.pdf')) {
                            return [Buffer.from('invoice text')]
                        }
                        if (storagePath.includes('notes.docx')) {
                            return [Buffer.from('notes text')]
                        }
                        return [Buffer.from('generic text')]
                    }),
                })),
            })),
        })),
    }
})

jest.mock('../WhatsApp/whatsAppFileExtraction', () => ({
    extractTextFromWhatsAppFile: jest.fn(async ({ fileName }) => {
        if (fileName === 'invoice.pdf') {
            return {
                extractedText: 'Invoice number 2026-01\nAmount due 400 EUR\nIBAN DE123',
                status: 'ok',
            }
        }
        if (fileName === 'notes.docx') {
            return {
                extractedText: 'Internal notes for the team',
                status: 'ok',
            }
        }
        return {
            extractedText: '',
            status: 'unsupported',
        }
    }),
}))

jest.mock('./emailReplyService', () => ({
    sendAnnaEmailReply: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('./emailAssistantBridge', () => ({
    processAnnaEmailAssistantMessage: jest.fn().mockResolvedValue('Processed'),
}))

jest.mock('./emailDailyTopic', () => ({
    getOrCreateDailyEmailTopic: jest.fn().mockResolvedValue({ chatId: 'chat-1' }),
    storeEmailAssistantMessageInTopic: jest.fn().mockResolvedValue('assistant-comment'),
    storeEmailUserMessageInTopic: jest.fn().mockResolvedValue('user-comment'),
}))

const { processAnnaEmailAssistantMessage } = require('./emailAssistantBridge')
const { storeEmailUserMessageInTopic } = require('./emailDailyTopic')
const { __private__ } = require('./emailInboundQueueProcessor')

describe('emailInboundQueueProcessor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('selects the most relevant attachment and passes it to the assistant', async () => {
        const queueRef = {
            delete: jest.fn().mockResolvedValue(undefined),
        }

        await __private__.processQueueItem('user-1', {
            id: 'msg-1',
            ref: queueRef,
            data: {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageId: 'msg-1',
                fromEmail: 'sender@example.com',
                subject: 'Fwd: invoice',
                textBody: 'Please process the attached invoice',
                attachments: [
                    {
                        fileName: 'notes.docx',
                        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        storagePath: 'anna-email-inbound/msg-1/1-notes.docx',
                    },
                    {
                        fileName: 'invoice.pdf',
                        contentType: 'application/pdf',
                        storagePath: 'anna-email-inbound/msg-1/2-invoice.pdf',
                    },
                ],
            },
        })

        expect(storeEmailUserMessageInTopic).toHaveBeenCalled()
        expect(processAnnaEmailAssistantMessage).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            'chat-1',
            'Subject: Fwd: invoice\n\nPlease process the attached invoice',
            'assistant-1',
            expect.objectContaining({
                initialPendingAttachmentPayload: expect.objectContaining({
                    fileName: 'invoice.pdf',
                    fileMimeType: 'application/pdf',
                    source: 'email',
                    messageId: 'msg-1',
                }),
            })
        )
    })

    test('continues without attachment payload when no supported attachment exists', async () => {
        const queueRef = {
            delete: jest.fn().mockResolvedValue(undefined),
        }

        await __private__.processQueueItem('user-1', {
            id: 'msg-2',
            ref: queueRef,
            data: {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageId: 'msg-2',
                fromEmail: 'sender@example.com',
                subject: 'Hello',
                textBody: 'No document here',
                attachments: [
                    {
                        fileName: 'logo.png',
                        contentType: 'image/png',
                        storagePath: 'anna-email-inbound/msg-2/1-logo.png',
                    },
                ],
            },
        })

        expect(processAnnaEmailAssistantMessage).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            'chat-1',
            'Subject: Hello\n\nNo document here',
            'assistant-1',
            expect.objectContaining({
                initialPendingAttachmentPayload: null,
            })
        )
    })
})
