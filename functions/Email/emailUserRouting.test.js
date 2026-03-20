'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    auth: jest.fn(),
}))

const admin = require('firebase-admin')
const { findVerifiedUserByEmailIdentity, hasActiveConnectedGmailEmail } = require('./emailUserRouting')

function buildUserDoc(id, data) {
    return {
        id,
        data: () => data,
    }
}

function buildPrivateDoc(userId, data, userDataById) {
    return {
        data: () => data,
        ref: {
            parent: {
                parent: {
                    id: userId,
                    get: jest.fn().mockResolvedValue({
                        exists: !!userDataById[userId],
                        data: () => userDataById[userId],
                    }),
                },
            },
        },
    }
}

function buildQuery(docs) {
    return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
            empty: docs.length === 0,
            docs,
        }),
    }
}

describe('emailUserRouting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('recognizes an active connected Gmail email on the user record', () => {
        expect(
            hasActiveConnectedGmailEmail(
                {
                    apisConnected: {
                        projectA: { gmail: true, gmailEmail: 'Karsten@alldone.app' },
                        projectB: { gmail: false, gmailEmail: 'other@example.com' },
                    },
                },
                'karsten@alldone.app'
            )
        ).toBe(true)
    })

    test('matches a verified primary email', async () => {
        const userDataById = {
            user1: { email: 'karsten.wysk@gmail.com', apisConnected: {} },
        }

        admin.firestore.mockReturnValue({
            collection: jest.fn().mockReturnValue(buildQuery([buildUserDoc('user1', userDataById.user1)])),
            collectionGroup: jest.fn().mockReturnValue(buildQuery([])),
        })
        admin.auth.mockReturnValue({
            getUser: jest.fn().mockResolvedValue({
                email: 'karsten.wysk@gmail.com',
                emailVerified: true,
            }),
        })

        const result = await findVerifiedUserByEmailIdentity('karsten.wysk@gmail.com')
        expect(result?.uid).toBe('user1')
    })

    test('matches a unique connected Gmail email', async () => {
        const userDataById = {
            user1: {
                email: 'karsten.wysk@gmail.com',
                apisConnected: {
                    p1: { gmail: true, gmailEmail: 'karsten@alldone.app' },
                },
            },
        }

        admin.firestore.mockReturnValue({
            collection: jest.fn().mockReturnValue(buildQuery([])),
            collectionGroup: jest
                .fn()
                .mockReturnValue(
                    buildQuery([
                        buildPrivateDoc('user1', { service: 'gmail', email: 'karsten@alldone.app' }, userDataById),
                    ])
                ),
        })
        admin.auth.mockReturnValue({
            getUser: jest.fn(),
        })

        const result = await findVerifiedUserByEmailIdentity('karsten@alldone.app')
        expect(result?.uid).toBe('user1')
    })

    test('dedupes the same user when the same email is both primary and connected Gmail', async () => {
        const userDataById = {
            user1: {
                email: 'karsten.wysk@gmail.com',
                apisConnected: {
                    p1: { gmail: true, gmailEmail: 'karsten.wysk@gmail.com' },
                },
            },
        }

        admin.firestore.mockReturnValue({
            collection: jest.fn().mockReturnValue(buildQuery([buildUserDoc('user1', userDataById.user1)])),
            collectionGroup: jest
                .fn()
                .mockReturnValue(
                    buildQuery([
                        buildPrivateDoc('user1', { service: 'gmail', email: 'karsten.wysk@gmail.com' }, userDataById),
                    ])
                ),
        })
        admin.auth.mockReturnValue({
            getUser: jest.fn().mockResolvedValue({
                email: 'karsten.wysk@gmail.com',
                emailVerified: true,
            }),
        })

        const result = await findVerifiedUserByEmailIdentity('karsten.wysk@gmail.com')
        expect(result?.uid).toBe('user1')
    })

    test('returns null when the connected Gmail email is ambiguous across users', async () => {
        const userDataById = {
            user1: {
                email: 'karsten.wysk@gmail.com',
                apisConnected: {
                    p1: { gmail: true, gmailEmail: 'karsten@alldone.app' },
                },
            },
            user2: {
                email: 'other@gmail.com',
                apisConnected: {
                    p2: { gmail: true, gmailEmail: 'karsten@alldone.app' },
                },
            },
        }

        admin.firestore.mockReturnValue({
            collection: jest.fn().mockReturnValue(buildQuery([])),
            collectionGroup: jest
                .fn()
                .mockReturnValue(
                    buildQuery([
                        buildPrivateDoc('user1', { service: 'gmail', email: 'karsten@alldone.app' }, userDataById),
                        buildPrivateDoc('user2', { service: 'gmail', email: 'karsten@alldone.app' }, userDataById),
                    ])
                ),
        })
        admin.auth.mockReturnValue({
            getUser: jest.fn(),
        })

        const result = await findVerifiedUserByEmailIdentity('karsten@alldone.app')
        expect(result).toBeNull()
    })
})
