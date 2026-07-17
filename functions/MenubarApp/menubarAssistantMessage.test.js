'use strict'

const { __private__ } = require('./menubarApp')

const { buildAssistantMessageDocId, decodeAssistantMessageImage } = __private__

const PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64')

describe('menubar assistant message idempotency', () => {
    test('deduplicates retries of the same requestId', () => {
        expect(buildAssistantMessageDocId('user-1', 'ask-abc')).toBe(buildAssistantMessageDocId('user-1', 'ask-abc'))
    })

    test('separates users and requests', () => {
        expect(buildAssistantMessageDocId('user-1', 'ask-abc')).not.toBe(
            buildAssistantMessageDocId('user-2', 'ask-abc')
        )
        expect(buildAssistantMessageDocId('user-1', 'ask-abc')).not.toBe(
            buildAssistantMessageDocId('user-1', 'ask-def')
        )
    })
})

describe('menubar assistant message image validation', () => {
    test('image is optional', () => {
        expect(decodeAssistantMessageImage(undefined)).toBeNull()
        expect(decodeAssistantMessageImage(null)).toBeNull()
    })

    test('accepts a valid jpeg and derives a file name', () => {
        const image = decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: PNG_BASE64 })
        expect(image.mimeType).toBe('image/jpeg')
        expect(image.fileName).toMatch(/^screenshot-\d+\.jpg$/)
        expect(image.data.equals(Buffer.from('fake-png-bytes'))).toBe(true)
    })

    test('accepts a valid png', () => {
        const image = decodeAssistantMessageImage({ mimeType: 'image/png', dataBase64: PNG_BASE64 })
        expect(image.fileName).toMatch(/\.png$/)
    })

    test('rejects unsupported mime types', () => {
        expect(() => decodeAssistantMessageImage({ mimeType: 'image/webp', dataBase64: PNG_BASE64 })).toThrow(
            'image mimeType is not supported'
        )
    })

    test('rejects malformed base64', () => {
        expect(() => decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: 'not base64!!' })).toThrow(
            'image dataBase64 is invalid'
        )
        expect(() => decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: '' })).toThrow(
            'image dataBase64 is invalid'
        )
    })

    test('rejects oversized images with a 413-mapped code', () => {
        const big = Buffer.alloc(5000001).toString('base64')
        let caught
        try {
            decodeAssistantMessageImage({ mimeType: 'image/jpeg', dataBase64: big })
        } catch (error) {
            caught = error
        }
        expect(caught).toBeDefined()
        expect(caught.code).toBe('IMAGE_TOO_LARGE')
    })
})
