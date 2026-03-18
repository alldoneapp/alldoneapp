jest.mock('firebase-admin', () => ({
    storage: jest.fn(() => ({
        bucket: jest.fn(() => ({
            file: jest.fn(() => ({
                save: jest.fn(async () => {}),
            })),
            name: 'test-bucket',
        })),
    })),
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        validateWebhookSignature: jest.fn(() => true),
        sendWhatsAppMessage: jest.fn(async () => {}),
    }))
)

jest.mock('./whatsAppVoiceTranscription', () => ({
    transcribeWhatsAppVoiceMessage: jest.fn(),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({})),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../Firestore/assistantsFirestore', () => ({
    getDefaultAssistantData: jest.fn(),
}))

jest.mock('./whatsAppFileExtraction', () => ({
    extractTextFromWhatsAppFile: jest.fn(),
}))

jest.mock('./whatsAppMediaTokens', () => ({
    buildAttachmentToken: jest.fn(),
    buildImageToken: jest.fn(),
    buildVideoToken: jest.fn(),
    sanitizeTokenText: jest.fn(value => value),
}))

const { __private__ } = require('./whatsAppIncomingHandler')

describe('WhatsApp incoming media filename handling', () => {
    test('extractMediaItems preserves Twilio filenames when present', () => {
        const mediaItems = __private__.extractMediaItems(
            {
                MediaUrl0: 'https://example.com/media/0',
                MediaContentType0: 'application/pdf',
                MediaFileName0: 'Quarterly Report.pdf',
                MediaUrl1: 'https://example.com/media/1',
                MediaContentType1: 'image/jpeg',
                MediaFilename1: 'IMG_1024',
            },
            2
        )

        expect(mediaItems).toEqual([
            {
                url: 'https://example.com/media/0',
                contentType: 'application/pdf',
                index: 0,
                fileName: 'Quarterly Report.pdf',
            },
            {
                url: 'https://example.com/media/1',
                contentType: 'image/jpeg',
                index: 1,
                fileName: 'IMG_1024',
            },
        ])
    })

    test('buildStoredMediaFileName keeps the original filename when available', () => {
        expect(
            __private__.buildStoredMediaFileName(
                'Quarterly Report.pdf',
                'application/pdf',
                'https://example.com/media/0',
                0
            )
        ).toBe('Quarterly Report.pdf')
    })

    test('buildStoredMediaFileName appends an inferred extension when needed', () => {
        expect(__private__.buildStoredMediaFileName('IMG_1024', 'image/jpeg', 'https://example.com/media/1', 1)).toBe(
            'IMG_1024.jpg'
        )
    })

    test('buildStoredMediaFileName falls back to generated names when Twilio does not send one', () => {
        expect(__private__.buildStoredMediaFileName('', 'application/pdf', 'https://example.com/media/0', 2)).toMatch(
            /^\d+_2_[0-9a-f-]+\.pdf$/
        )
    })

    test('sanitizeIncomingMediaFileName strips path segments and unsafe empty values', () => {
        expect(__private__.sanitizeIncomingMediaFileName('folder/sub folder/invoice.pdf')).toBe('invoice.pdf')
        expect(__private__.sanitizeIncomingMediaFileName('   ')).toBe('')
        expect(__private__.sanitizeIncomingMediaFileName('..')).toBe('')
    })
})
