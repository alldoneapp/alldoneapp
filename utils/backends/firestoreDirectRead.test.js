const mockGetIdToken = jest.fn()
const mockDoc = jest.fn(path => ({ path }))
const mockAuthState = { currentUser: { getIdToken: mockGetIdToken } }

jest.mock('firebase/compat/app', () => {
    const firestore = jest.fn(() => ({ doc: mockDoc }))

    return {
        __esModule: true,
        default: {
            app: () => ({ options: { apiKey: 'test-api-key', projectId: 'test-project' } }),
            auth: () => mockAuthState,
            firestore,
        },
    }
})

import { readDocumentDirectlyFromServer, readLatestCommentDirectlyFromServer } from './firestoreDirectRead'

describe('readDocumentDirectlyFromServer', () => {
    const originalFetch = global.fetch

    beforeEach(() => {
        global.fetch = jest.fn()
        mockAuthState.currentUser = { getIdToken: mockGetIdToken }
        mockGetIdToken.mockReset().mockResolvedValue('id-token')
        mockDoc.mockClear()
    })

    afterAll(() => {
        global.fetch = originalFetch
    })

    it('reads and decodes a document through the authenticated REST endpoint', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([
                {
                    found: {
                        fields: {
                            title: { stringValue: 'Project' },
                            count: { integerValue: '12' },
                            ratio: { doubleValue: 1.5 },
                            active: { booleanValue: true },
                            empty: { nullValue: null },
                            when: { timestampValue: '2026-08-13T12:00:00.000Z' },
                            bytes: { bytesValue: 'YWJj' },
                            location: { geoPointValue: { latitude: 52.5, longitude: 13.4 } },
                            project: {
                                referenceValue:
                                    'projects/test-project/databases/(default)/documents/projects/project-1',
                            },
                            members: { arrayValue: { values: [{ stringValue: 'user-1' }] } },
                            nested: { mapValue: { fields: { enabled: { booleanValue: false } } } },
                        },
                    },
                },
            ]),
        })

        await expect(readDocumentDirectlyFromServer('/projects/project 1')).resolves.toEqual({
            exists: true,
            data: {
                title: 'Project',
                count: 12,
                ratio: 1.5,
                active: true,
                empty: null,
                when: new Date('2026-08-13T12:00:00.000Z'),
                bytes: 'YWJj',
                location: { latitude: 52.5, longitude: 13.4 },
                project: { path: 'projects/project-1' },
                members: ['user-1'],
                nested: { enabled: false },
            },
        })

        expect(mockGetIdToken).toHaveBeenCalledTimes(1)
        expect(global.fetch).toHaveBeenCalledWith(
            'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents:batchGet?key=test-api-key',
            {
                method: 'POST',
                cache: 'no-store',
                headers: {
                    Authorization: 'Bearer id-token',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    documents: ['projects/test-project/databases/(default)/documents/projects/project 1'],
                }),
            }
        )
    })

    it('returns an authoritative missing result from an HTTP 200 batch response', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: jest
                .fn()
                .mockResolvedValue([{ missing: 'projects/test-project/databases/(default)/documents/users/missing' }]),
        })

        await expect(readDocumentDirectlyFromServer('users/missing')).resolves.toEqual({
            exists: false,
            data: undefined,
        })
    })

    it('throws server errors instead of treating them as missing documents', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 403,
            json: jest.fn().mockResolvedValue({
                error: { message: 'Permission denied', status: 'PERMISSION_DENIED' },
            }),
        })

        await expect(readDocumentDirectlyFromServer('users/user-1')).rejects.toMatchObject({
            message: 'Permission denied',
            code: 'PERMISSION_DENIED',
        })
    })

    it('requires an authenticated user', async () => {
        mockAuthState.currentUser = null

        await expect(readDocumentDirectlyFromServer('users/user-1')).rejects.toThrow(
            'Cannot verify a Firestore document without an authenticated user'
        )
        expect(global.fetch).not.toHaveBeenCalled()
    })
    it('queries the latest comment with the authenticated, abortable request and decodes it', async () => {
        const controller = new AbortController()
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => [
                {
                    document: {
                        name: 'projects/test-project/databases/(default)/documents/chatComments/p/topics/c/comments/newest',
                        fields: { commentText: { stringValue: 'Latest reply' }, isStreaming: { booleanValue: true } },
                    },
                    readTime: '2026-09-07T00:00:00Z',
                },
            ],
        })
        await expect(
            readLatestCommentDirectlyFromServer('chatComments/p/topics/c', { signal: controller.signal })
        ).resolves.toEqual([{ id: 'newest', commentText: 'Latest reply', isStreaming: true }])
        const [url, request] = global.fetch.mock.calls[0]
        expect(url).toContain('/documents/chatComments/p/topics/c:runQuery?key=')
        expect(request.signal).toBe(controller.signal)
        expect(request.headers.Authorization).toBe('Bearer id-token')
        expect(JSON.parse(request.body).structuredQuery).toEqual({
            from: [{ collectionId: 'comments' }],
            orderBy: [{ field: { fieldPath: 'created' }, direction: 'DESCENDING' }],
            limit: 1,
        })
    })
    it('recognizes a server-confirmed empty query but rejects malformed results', async () => {
        global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ readTime: '2026-09-07T00:00:00Z' }] })
        await expect(readLatestCommentDirectlyFromServer('chatComments/p/topics/c')).resolves.toEqual([])
        global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [] })
        await expect(readLatestCommentDirectlyFromServer('chatComments/p/topics/c')).rejects.toThrow('no valid result')
    })
    it('does not mask query permission errors as an empty comment', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 403,
            json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'Denied' } }),
        })
        await expect(readLatestCommentDirectlyFromServer('chatComments/p/topics/c')).rejects.toMatchObject({
            code: 'PERMISSION_DENIED',
        })
    })
    it('does not send a request when cancellation happened during token lookup', async () => {
        const controller = new AbortController()
        mockGetIdToken.mockImplementation(async () => {
            controller.abort()
            return 'token'
        })
        await expect(readDocumentDirectlyFromServer('users/u', { signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        })
        await expect(
            readLatestCommentDirectlyFromServer('chatComments/p/topics/c', { signal: controller.signal })
        ).rejects.toMatchObject({ name: 'AbortError' })
        expect(global.fetch).not.toHaveBeenCalled()
    })
})
