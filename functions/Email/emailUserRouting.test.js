'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    auth: jest.fn(),
}))

jest.mock('./emailIdentityAttestation', () => ({
    PROOF_REJECTED: 'rejected',
    PROOF_UNVERIFIABLE: 'unverifiable',
    PROOF_VERIFIED: 'verified',
    ensureEmailIdentityAttestation: jest.fn().mockResolvedValue('verified'),
    getAttestedUserIdsForEmail: jest.fn().mockResolvedValue(new Set()),
    // The doc-id allowlist is real behaviour under test elsewhere; here it stays the
    // genuine implementation so a suite cannot accidentally accept a forged document.
    parseCredentialDocId: jest.requireActual('./emailIdentityAttestation').parseCredentialDocId,
}))

const admin = require('firebase-admin')
const { ensureEmailIdentityAttestation, getAttestedUserIdsForEmail } = require('./emailIdentityAttestation')
const {
    accountHasConnectedMailbox,
    findVerifiedUserByEmailIdentity,
    hasActiveConnectedGmailEmail,
    resolveEmailSenderIdentity,
} = require('./emailUserRouting')

function buildUserDoc(id, data) {
    return { id, data: () => data }
}

function buildCredentialDoc(userId, docId, data, userDataById) {
    return {
        id: docId,
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
        get: jest.fn().mockResolvedValue({ empty: docs.length === 0, docs }),
    }
}

function mockFirestore({ primaryDocs = [], credentialDocs = [] } = {}) {
    admin.firestore.mockReturnValue({
        collection: jest.fn().mockReturnValue(buildQuery(primaryDocs)),
        collectionGroup: jest.fn().mockReturnValue(buildQuery(credentialDocs)),
    })
}

function mockAuth(recordsByUid = {}) {
    admin.auth.mockReturnValue({
        getUser: jest.fn(async uid => {
            const record = recordsByUid[uid]
            if (!record) throw new Error('There is no user record corresponding to the provided identifier.')
            return record
        }),
    })
}

describe('emailUserRouting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ensureEmailIdentityAttestation.mockResolvedValue('verified')
        getAttestedUserIdsForEmail.mockResolvedValue(new Set())
        admin.auth.mockReturnValue({ getUser: jest.fn() })
    })

    describe('connected mailbox detection', () => {
        test('recognizes an active connected Gmail email on the legacy apisConnected map', () => {
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

        test('does not recognize a disconnected identity', () => {
            expect(
                accountHasConnectedMailbox(
                    { apisConnected: { p1: { gmail: false, gmailEmail: 'disconnected@example.com' } } },
                    'disconnected@example.com'
                )
            ).toBe(false)
        })

        // The account-level map is the current shape; reading only apisConnected made a
        // freshly connected mailbox invisible to the email channel.
        test('recognizes a connection that exists only in the account-level emailConnections map', () => {
            expect(
                accountHasConnectedMailbox(
                    {
                        emailConnections: {
                            email_google_e0d5b4af: {
                                provider: 'google',
                                emailAddress: 'karsten@alldone.app',
                                defaultProjectId: 'p1',
                            },
                        },
                    },
                    'karsten@alldone.app'
                )
            ).toBe(true)
        })

        // listEmailConnections returns the stored map OR the synthesized legacy one, never
        // both, so the legacy map has to be checked as a union or a legacy-only connection
        // disappears the moment any account-level connection exists.
        test('still recognizes a legacy-only connection when the account-level map is populated', () => {
            expect(
                accountHasConnectedMailbox(
                    {
                        emailConnections: {
                            email_google_11111111: { provider: 'google', emailAddress: 'other@example.com' },
                        },
                        apisConnected: { p1: { gmail: true, gmailEmail: 'legacy@example.com' } },
                    },
                    'legacy@example.com'
                )
            ).toBe(true)
        })

        test('recognizes a Microsoft mailbox', () => {
            expect(
                accountHasConnectedMailbox(
                    {
                        emailConnections: {
                            email_microsoft_22222222: {
                                provider: 'microsoft',
                                emailAddress: 'karsten@outlook.com',
                            },
                        },
                    },
                    'karsten@outlook.com'
                )
            ).toBe(true)
        })
    })

    describe('sender resolution', () => {
        test('matches a verified primary email', async () => {
            const userData = { email: 'karsten.wysk@gmail.com', apisConnected: {} }
            mockFirestore({ primaryDocs: [buildUserDoc('user1', userData)] })
            mockAuth({ user1: { email: 'karsten.wysk@gmail.com', emailVerified: true } })

            const result = await resolveEmailSenderIdentity('karsten.wysk@gmail.com')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('user1')
        })

        test('does not match an unverified primary email', async () => {
            const userData = { email: 'unverified@example.com', apisConnected: {} }
            mockFirestore({ primaryDocs: [buildUserDoc('user1', userData)] })
            mockAuth({ user1: { email: 'unverified@example.com', emailVerified: false } })

            const result = await resolveEmailSenderIdentity('unverified@example.com')
            expect(result.status).toBe('unknown')
            expect(await findVerifiedUserByEmailIdentity('unverified@example.com')).toBeNull()
        })

        test('matches a unique connected mailbox', async () => {
            const userDataById = {
                user1: {
                    email: 'karsten.wysk@gmail.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'karsten@alldone.app' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('user1')
        })

        test('dedupes the same account when the address is both its login and a connected mailbox', async () => {
            const userData = {
                email: 'karsten.wysk@gmail.com',
                apisConnected: { p1: { gmail: true, gmailEmail: 'karsten.wysk@gmail.com' } },
            }
            const userDataById = { user1: userData }
            mockFirestore({
                primaryDocs: [buildUserDoc('user1', userData)],
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'karsten.wysk@gmail.com' },
                        userDataById
                    ),
                ],
            })
            mockAuth({ user1: { email: 'karsten.wysk@gmail.com', emailVerified: true } })

            const result = await resolveEmailSenderIdentity('karsten.wysk@gmail.com')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('user1')
        })

        // THE REGRESSION. A second account signed up with Google using an address the main
        // account had long had connected. Both claims are genuine, the old lookup merged
        // them into one bag, saw two entries and reported "no verified account email".
        test('prefers the attested connected mailbox over a newer account that merely logs in with the address (AT-2483)', async () => {
            const userDataById = {
                mainAccount: {
                    email: 'karsten.wysk@gmail.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'karsten@alldone.app' } },
                },
            }
            mockFirestore({
                primaryDocs: [buildUserDoc('newAccount', { email: 'karsten@alldone.app' })],
                credentialDocs: [
                    buildCredentialDoc(
                        'mainAccount',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                ],
            })
            mockAuth({ newAccount: { email: 'karsten@alldone.app', emailVerified: true } })

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('mainAccount')
        })

        // The same shape as above, except the connection cannot be proven. An unprovable
        // claim must never outrank Firebase Auth.
        test('falls back to the verified login email when the connected mailbox cannot be attested', async () => {
            ensureEmailIdentityAttestation.mockResolvedValue('unverifiable')
            const userDataById = {
                mainAccount: {
                    email: 'karsten.wysk@gmail.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'karsten@alldone.app' } },
                },
            }
            mockFirestore({
                primaryDocs: [buildUserDoc('newAccount', { email: 'karsten@alldone.app' })],
                credentialDocs: [
                    buildCredentialDoc(
                        'mainAccount',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                ],
            })
            mockAuth({ newAccount: { email: 'karsten@alldone.app', emailVerified: true } })

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('newAccount')
        })

        // ... but an unprovable claim is still better than nothing, which is how every
        // connection behaved before attestations existed.
        test('still routes an unattested connection when it is the only claim', async () => {
            ensureEmailIdentityAttestation.mockResolvedValue('unverifiable')
            const userDataById = {
                user1: {
                    email: 'someone@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'karsten@alldone.app' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('user1')
        })

        test('drops a connected mailbox the provider disowns, even when it is the only claim', async () => {
            ensureEmailIdentityAttestation.mockResolvedValue('rejected')
            const userDataById = {
                impostor: {
                    email: 'impostor@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'victim@example.com' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'impostor',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'victim@example.com' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('victim@example.com')
            expect(result.status).toBe('unknown')
        })

        test('a rejected connection cannot beat the account that really owns the login email', async () => {
            ensureEmailIdentityAttestation.mockResolvedValue('rejected')
            const userDataById = {
                impostor: {
                    email: 'impostor@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'victim@example.com' } },
                },
            }
            mockFirestore({
                primaryDocs: [buildUserDoc('victim', { email: 'victim@example.com' })],
                credentialDocs: [
                    buildCredentialDoc(
                        'impostor',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'victim@example.com' },
                        userDataById
                    ),
                ],
            })
            mockAuth({ victim: { email: 'victim@example.com', emailVerified: true } })

            const result = await resolveEmailSenderIdentity('victim@example.com')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('victim')
        })

        // `users/{uid}/private/**` is owner-writable, so the collection-group scan cannot
        // treat any document carrying `email` + `service` as a connection.
        test('ignores a private document that is not a provider credential document', async () => {
            const userDataById = {
                impostor: {
                    email: 'impostor@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'victim@example.com' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'impostor',
                        'notARealCredentialDoc',
                        { service: 'gmail', email: 'victim@example.com' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('victim@example.com')
            expect(result.status).toBe('unknown')
            expect(ensureEmailIdentityAttestation).not.toHaveBeenCalled()
        })

        test('ignores a calendar credential document, which names the same address', async () => {
            const userDataById = {
                user1: {
                    email: 'someone@example.com',
                    apisConnected: { p1: { calendar: true, calendarEmail: 'karsten@alldone.app' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'googleAuth_p1_calendar',
                        { service: 'calendar', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('unknown')
        })

        test('skips the orphaned credential documents of deleted accounts', async () => {
            const userDataById = {
                alive: {
                    email: 'someone@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'karsten@alldone.app' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'deleted',
                        'googleAuth_pX_gmail',
                        { service: 'gmail', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                    buildCredentialDoc(
                        'alive',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'karsten@alldone.app' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('alive')
        })

        test('refuses to guess between two equally attested connected mailboxes', async () => {
            const userDataById = {
                user1: {
                    email: 'a@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'shared@example.com' } },
                },
                user2: {
                    email: 'b@example.com',
                    apisConnected: { p2: { gmail: true, gmailEmail: 'shared@example.com' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'shared@example.com' },
                        userDataById
                    ),
                    buildCredentialDoc(
                        'user2',
                        'googleAuth_p2_gmail',
                        { service: 'gmail', email: 'shared@example.com' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('shared@example.com')
            expect(result.status).toBe('ambiguous')
            expect(result.user).toBeNull()
            expect(result.candidates).toHaveLength(2)
        })

        test('matches a connected Microsoft mailbox end to end', async () => {
            const userDataById = {
                user1: {
                    email: 'someone@example.com',
                    emailConnections: {
                        email_microsoft_22222222: { provider: 'microsoft', emailAddress: 'karsten@outlook.com' },
                    },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'microsoftAuth_email_microsoft_22222222',
                        { service: 'email', email: 'karsten@outlook.com' },
                        userDataById
                    ),
                ],
            })

            const result = await resolveEmailSenderIdentity('karsten@outlook.com')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('user1')
        })

        test('falls back cleanly when the connected mailbox lookup errors', async () => {
            const userData = { email: 'karsten.wysk@gmail.com', apisConnected: {} }
            admin.firestore.mockReturnValue({
                collection: jest.fn().mockReturnValue(buildQuery([buildUserDoc('user1', userData)])),
                collectionGroup: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnThis(),
                    limit: jest.fn().mockReturnThis(),
                    get: jest.fn().mockRejectedValue(new Error('9 FAILED_PRECONDITION: missing index')),
                }),
            })
            mockAuth({ user1: { email: 'karsten.wysk@gmail.com', emailVerified: true } })

            const result = await resolveEmailSenderIdentity('karsten.wysk@gmail.com')
            expect(result.status).toBe('matched')
            expect(result.user.uid).toBe('user1')
        })

        // A users document whose Firebase Auth record was deleted is not an owner. This is
        // what the production logs showed for one of the two duplicate accounts.
        test('skips a users document whose auth record no longer exists', async () => {
            mockFirestore({ primaryDocs: [buildUserDoc('ghost', { email: 'karsten@alldone.app' })] })
            mockAuth({})

            const result = await resolveEmailSenderIdentity('karsten@alldone.app')
            expect(result.status).toBe('unknown')
        })

        test('pays for the attestation read once, however many accounts claim the address', async () => {
            const userDataById = {
                user1: {
                    email: 'a@example.com',
                    apisConnected: { p1: { gmail: true, gmailEmail: 'shared@example.com' } },
                },
                user2: {
                    email: 'b@example.com',
                    apisConnected: { p2: { gmail: true, gmailEmail: 'shared@example.com' } },
                },
            }
            mockFirestore({
                credentialDocs: [
                    buildCredentialDoc(
                        'user1',
                        'googleAuth_p1_gmail',
                        { service: 'gmail', email: 'shared@example.com' },
                        userDataById
                    ),
                    buildCredentialDoc(
                        'user2',
                        'googleAuth_p2_gmail',
                        { service: 'gmail', email: 'shared@example.com' },
                        userDataById
                    ),
                ],
            })

            await resolveEmailSenderIdentity('shared@example.com')
            expect(getAttestedUserIdsForEmail).toHaveBeenCalledTimes(1)
        })

        test('never reads attestations when nothing claims a connected mailbox', async () => {
            const userData = { email: 'solo@example.com', apisConnected: {} }
            mockFirestore({ primaryDocs: [buildUserDoc('user1', userData)] })
            mockAuth({ user1: { email: 'solo@example.com', emailVerified: true } })

            await resolveEmailSenderIdentity('solo@example.com')
            expect(getAttestedUserIdsForEmail).not.toHaveBeenCalled()
        })
    })
})
