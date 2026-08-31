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

import { readDocumentDirectlyFromServer } from './firestoreDirectRead'

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
})
