'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAuthorizedOAuth2Client: jest.fn(),
}))

jest.mock('../MicrosoftOAuth/microsoftOAuthHandler', () => ({
    getAccessToken: jest.fn(),
    graphRequest: jest.fn(),
}))

const admin = require('firebase-admin')
const { getAuthorizedOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { getAccessToken, graphRequest } = require('../MicrosoftOAuth/microsoftOAuthHandler')
const {
    buildEmailIdentityKey,
    clearOwnershipProbeCache,
    ensureEmailIdentityAttestation,
    getAttestedUserIdsForEmail,
    isDefinitiveCredentialFailure,
    parseCredentialDocId,
    probeMailboxOwnership,
    recordEmailIdentityAttestation,
    removeEmailIdentityAttestation,
} = require('./emailIdentityAttestation')

function mockAttestationCollection({ docs = [], setImpl, deleteImpl, getImpl } = {}) {
    const set = setImpl || jest.fn().mockResolvedValue(undefined)
    const del = deleteImpl || jest.fn().mockResolvedValue(undefined)
    const collectionGet = getImpl || jest.fn().mockResolvedValue({ docs })
    const accounts = {
        doc: jest.fn(() => ({ set, delete: del })),
        get: collectionGet,
    }
    admin.firestore.mockReturnValue({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({ collection: jest.fn(() => accounts) })),
        })),
    })
    return { set, delete: del, collectionGet, accounts }
}

describe('emailIdentityAttestation', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        clearOwnershipProbeCache()
    })

    describe('buildEmailIdentityKey', () => {
        test('is deterministic and case/whitespace insensitive', () => {
            expect(buildEmailIdentityKey(' Karsten@Alldone.app ')).toBe(buildEmailIdentityKey('karsten@alldone.app'))
            expect(buildEmailIdentityKey('karsten@alldone.app')).toMatch(/^[0-9a-f]{64}$/)
        })

        test('never leaks the address itself into the document id', () => {
            expect(buildEmailIdentityKey('karsten@alldone.app')).not.toContain('alldone')
        })

        test('is empty for an empty address', () => {
            expect(buildEmailIdentityKey('')).toBe('')
        })
    })

    // The allowlist that stops an owner-written `private/**` document from presenting
    // itself as an OAuth connection.
    describe('parseCredentialDocId', () => {
        test.each([
            ['googleAuth_email_google_ab12cd34', 'google', 'email_google_ab12cd34'],
            ['googleAuth_-M6X9vdIokG7HAammHGg_gmail', 'google', '-M6X9vdIokG7HAammHGg'],
            ['googleAuth_-M6X9vdIokG7HAammHGg', 'google', '-M6X9vdIokG7HAammHGg'],
            ['microsoftAuth_email_microsoft_ab12cd34', 'microsoft', 'email_microsoft_ab12cd34'],
            ['microsoftAuth_-M6X9vdIokG7HAammHGg_email', 'microsoft', '-M6X9vdIokG7HAammHGg'],
        ])('parses %s', (docId, provider, reference) => {
            expect(parseCredentialDocId(docId)).toEqual({
                provider,
                reference,
                service: provider === 'microsoft' ? 'email' : 'gmail',
            })
        })

        test.each([
            'clockSync',
            'gmailLabeling_-M6X9vdIokG7HAammHGg',
            'gitlabAuth_-M6X9vdIokG7HAammHGg',
            'notARealCredentialDoc',
            'googleAuth_',
            '',
        ])('rejects %s', docId => {
            expect(parseCredentialDocId(docId)).toBeNull()
        })

        test('rejects calendar credentials, which name the same address but are not a mailbox', () => {
            expect(parseCredentialDocId('googleAuth_calendar_google_ab12cd34')).toBeNull()
            expect(parseCredentialDocId('googleAuth_-M6X9vdIokG7HAammHGg_calendar')).toBeNull()
        })
    })

    describe('probeMailboxOwnership', () => {
        test('verifies when Google names the same address', async () => {
            getAuthorizedOAuth2Client.mockResolvedValue({
                request: jest.fn().mockResolvedValue({ data: { email: 'Karsten@Alldone.app' } }),
            })

            await expect(
                probeMailboxOwnership({
                    userId: 'u1',
                    email: 'karsten@alldone.app',
                    provider: 'google',
                    reference: 'p1',
                })
            ).resolves.toEqual({ status: 'verified', observedEmail: 'karsten@alldone.app' })
        })

        // The forgery case: real credentials, someone else's address in the document.
        test('rejects when Google names a different address', async () => {
            getAuthorizedOAuth2Client.mockResolvedValue({
                request: jest.fn().mockResolvedValue({ data: { email: 'impostor@example.com' } }),
            })

            const result = await probeMailboxOwnership({
                userId: 'u1',
                email: 'victim@example.com',
                provider: 'google',
                reference: 'p1',
            })
            expect(result.status).toBe('rejected')
        })

        // A fabricated token document: the provider refuses the credentials outright.
        test('rejects credentials the provider refuses', async () => {
            getAuthorizedOAuth2Client.mockRejectedValue(new Error('invalid_grant: Bad Request'))

            const result = await probeMailboxOwnership({
                userId: 'u1',
                email: 'victim@example.com',
                provider: 'google',
                reference: 'p1',
            })
            expect(result.status).toBe('rejected')
        })

        // An outage must not revoke everybody's routing, so it is distinct from a refusal.
        test('reports a transient failure as unverifiable, not rejected', async () => {
            getAuthorizedOAuth2Client.mockRejectedValue(new Error('ECONNRESET'))

            const result = await probeMailboxOwnership({
                userId: 'u1',
                email: 'victim@example.com',
                provider: 'google',
                reference: 'p1',
            })
            expect(result.status).toBe('unverifiable')
        })

        // A token whose consent never included userinfo.email still holds a Gmail scope,
        // and an unanswered probe would cost a legitimate connection its precedence.
        test('falls back to the Gmail profile when userinfo is not available', async () => {
            const request = jest
                .fn()
                .mockRejectedValueOnce(new Error('Request had insufficient authentication scopes.'))
                .mockResolvedValueOnce({ data: { emailAddress: 'karsten@alldone.app' } })
            getAuthorizedOAuth2Client.mockResolvedValue({ request })

            const result = await probeMailboxOwnership({
                userId: 'u1',
                email: 'karsten@alldone.app',
                provider: 'google',
                reference: 'p1',
            })
            expect(result.status).toBe('verified')
            expect(request).toHaveBeenCalledTimes(2)
        })

        test('does not fall back when the credentials themselves were refused', async () => {
            const request = jest.fn().mockRejectedValue(new Error('invalid_grant: Token has been expired or revoked'))
            getAuthorizedOAuth2Client.mockResolvedValue({ request })

            const result = await probeMailboxOwnership({
                userId: 'u1',
                email: 'karsten@alldone.app',
                provider: 'google',
                reference: 'p1',
            })
            expect(result.status).toBe('rejected')
            expect(request).toHaveBeenCalledTimes(1)
        })

        test('verifies a Microsoft mailbox through Graph', async () => {
            getAccessToken.mockResolvedValue('token')
            graphRequest.mockResolvedValue({ userPrincipalName: 'Karsten@outlook.com' })

            await expect(
                probeMailboxOwnership({
                    userId: 'u1',
                    email: 'karsten@outlook.com',
                    provider: 'microsoft',
                    reference: 'email_microsoft_ab12cd34',
                })
            ).resolves.toEqual({ status: 'verified', observedEmail: 'karsten@outlook.com' })
        })

        test('is unverifiable when the provider answers with no address at all', async () => {
            getAuthorizedOAuth2Client.mockResolvedValue({ request: jest.fn().mockResolvedValue({ data: {} }) })

            const result = await probeMailboxOwnership({
                userId: 'u1',
                email: 'victim@example.com',
                provider: 'google',
                reference: 'p1',
            })
            expect(result.status).toBe('unverifiable')
        })
    })

    describe('isDefinitiveCredentialFailure', () => {
        test('recognizes revoked credentials', () => {
            const revoked = new Error('boom')
            revoked.name = 'GoogleAuthRevokedError'
            expect(isDefinitiveCredentialFailure(revoked)).toBe(true)
            expect(isDefinitiveCredentialFailure(new Error('invalid_grant'))).toBe(true)
        })

        test('does not treat a network failure as definitive', () => {
            expect(isDefinitiveCredentialFailure(new Error('socket hang up'))).toBe(false)
            expect(isDefinitiveCredentialFailure(undefined)).toBe(false)
        })
    })

    describe('ensureEmailIdentityAttestation', () => {
        test('trusts an existing attestation without calling the provider', async () => {
            mockAttestationCollection()

            const status = await ensureEmailIdentityAttestation({
                userId: 'u1',
                email: 'karsten@alldone.app',
                provider: 'google',
                credentialDocId: 'googleAuth_p1_gmail',
                attestedUserIds: new Set(['u1']),
            })

            expect(status).toBe('verified')
            expect(getAuthorizedOAuth2Client).not.toHaveBeenCalled()
        })

        // No migration: a connection made long before attestations existed proves itself
        // the first time an inbound message needs it, and is recorded from then on.
        test('proves an existing connection lazily and records it', async () => {
            const { set } = mockAttestationCollection()
            getAuthorizedOAuth2Client.mockResolvedValue({
                request: jest.fn().mockResolvedValue({ data: { email: 'karsten@alldone.app' } }),
            })

            const status = await ensureEmailIdentityAttestation({
                userId: 'u1',
                email: 'karsten@alldone.app',
                provider: 'google',
                credentialDocId: 'googleAuth_p1_gmail',
                attestedUserIds: new Set(),
            })

            expect(status).toBe('verified')
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'u1',
                    email: 'karsten@alldone.app',
                    source: 'inbound_probe',
                }),
                { merge: true }
            )
        })

        test('rejects a claim the provider disowns and records nothing', async () => {
            const { set } = mockAttestationCollection()
            getAuthorizedOAuth2Client.mockResolvedValue({
                request: jest.fn().mockResolvedValue({ data: { email: 'impostor@example.com' } }),
            })

            const status = await ensureEmailIdentityAttestation({
                userId: 'impostor',
                email: 'victim@example.com',
                provider: 'google',
                credentialDocId: 'googleAuth_p1_gmail',
                attestedUserIds: new Set(),
            })

            expect(status).toBe('rejected')
            expect(set).not.toHaveBeenCalled()
        })

        test('rejects a document that is not a provider credential without probing', async () => {
            mockAttestationCollection()

            const status = await ensureEmailIdentityAttestation({
                userId: 'impostor',
                email: 'victim@example.com',
                provider: 'google',
                credentialDocId: 'handWrittenDoc',
                attestedUserIds: new Set(),
            })

            expect(status).toBe('rejected')
            expect(getAuthorizedOAuth2Client).not.toHaveBeenCalled()
        })

        // A busy mailbox must not re-probe the provider on every inbound message.
        test('does not re-probe a failed claim within the negative cache window', async () => {
            mockAttestationCollection()
            getAuthorizedOAuth2Client.mockRejectedValue(new Error('ECONNRESET'))

            const args = {
                userId: 'u1',
                email: 'karsten@alldone.app',
                provider: 'google',
                credentialDocId: 'googleAuth_p1_gmail',
                attestedUserIds: new Set(),
            }
            expect(await ensureEmailIdentityAttestation(args)).toBe('unverifiable')
            expect(await ensureEmailIdentityAttestation(args)).toBe('unverifiable')
            expect(getAuthorizedOAuth2Client).toHaveBeenCalledTimes(1)
        })
    })

    describe('attestation storage', () => {
        test('reads back the attested account ids and skips revoked entries', async () => {
            mockAttestationCollection({
                docs: [
                    { id: 'u1', data: () => ({ userId: 'u1' }) },
                    { id: 'u2', data: () => ({ userId: 'u2', revoked: true }) },
                ],
            })

            const attested = await getAttestedUserIdsForEmail('karsten@alldone.app')
            expect([...attested]).toEqual(['u1'])
        })

        // Losing the personalization is a bad day; failing the inbound email is a broken
        // feature. Every storage failure degrades instead of throwing.
        test('never throws when the attestation store is unavailable', async () => {
            mockAttestationCollection({
                getImpl: jest.fn().mockRejectedValue(new Error('unavailable')),
                setImpl: jest.fn().mockRejectedValue(new Error('unavailable')),
                deleteImpl: jest.fn().mockRejectedValue(new Error('unavailable')),
            })

            await expect(getAttestedUserIdsForEmail('x@example.com')).resolves.toEqual(new Set())
            await expect(recordEmailIdentityAttestation({ userId: 'u1', email: 'x@example.com' })).resolves.toBe(false)
            await expect(removeEmailIdentityAttestation({ userId: 'u1', email: 'x@example.com' })).resolves.toBe(false)
        })

        test('ignores an attestation write with no account or address', async () => {
            const { set } = mockAttestationCollection()
            await expect(recordEmailIdentityAttestation({ userId: '', email: 'x@example.com' })).resolves.toBe(false)
            await expect(recordEmailIdentityAttestation({ userId: 'u1', email: '' })).resolves.toBe(false)
            expect(set).not.toHaveBeenCalled()
        })
    })
})
