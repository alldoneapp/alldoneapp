'use strict'

const { buildConnectionId } = require('../../Integrations/providerConnections')
const { EmailLineAuthError } = require('./emailLineErrors')
const {
    buildEmailAuthInvalidUpdate,
    getEmailLineSummaryResponse,
    markEmailConnectionAuthInvalid,
} = require('./emailLineSummaryResponse')

const accountEmail = 'person@example.com'
const accountConnectionId = buildConnectionId('email', 'google', accountEmail)

describe('emailLineSummaryResponse', () => {
    test('returns a structured authExpired response and persists an account-level connection flag', async () => {
        const userData = {
            emailConnections: {
                [accountConnectionId]: {
                    provider: 'google',
                    emailAddress: accountEmail,
                    defaultProjectId: 'project-1',
                    authInvalid: false,
                },
            },
        }
        const update = jest.fn().mockResolvedValue(undefined)
        const firestore = { doc: jest.fn(() => ({ update })) }
        const getSummary = jest.fn().mockRejectedValue(new EmailLineAuthError())
        const persistAuthInvalid = (userId, context) => markEmailConnectionAuthInvalid(userId, context, { firestore })

        await expect(
            getEmailLineSummaryResponse({
                userId: 'user-1',
                key: accountConnectionId,
                userData,
                getSummary,
                persistAuthInvalid,
            })
        ).resolves.toEqual({ authExpired: true })

        expect(firestore.doc).toHaveBeenCalledWith('users/user-1')
        expect(update).toHaveBeenCalledWith({
            [`emailConnections.${accountConnectionId}.authInvalid`]: true,
        })
    })

    test('materializes every legacy account before marking the failed project connection invalid', async () => {
        const secondConnectionId = buildConnectionId('email', 'microsoft', 'other@example.com')
        const userData = {
            apisConnected: {
                'project-1': {
                    gmail: true,
                    gmailEmail: accountEmail,
                    gmailDefault: true,
                },
                'project-2': {
                    email: true,
                    emailProvider: 'microsoft',
                    emailAddress: 'other@example.com',
                },
            },
        }
        const update = buildEmailAuthInvalidUpdate(userData, 'project-1')

        expect(Object.keys(update.emailConnections)).toEqual(
            expect.arrayContaining([accountConnectionId, secondConnectionId])
        )
        expect(update.emailConnections[accountConnectionId].authInvalid).toBe(true)
        expect(update.emailConnections[secondConnectionId].authInvalid).toBe(false)

        const firestoreUpdate = jest.fn().mockResolvedValue(undefined)
        const getSummary = jest.fn().mockRejectedValue(new EmailLineAuthError())
        await expect(
            getEmailLineSummaryResponse({
                userId: 'legacy-user',
                key: 'project-1',
                userData,
                getSummary,
                persistAuthInvalid: (userId, context) =>
                    markEmailConnectionAuthInvalid(userId, context, {
                        firestore: { doc: jest.fn(() => ({ update: firestoreUpdate })) },
                    }),
            })
        ).resolves.toEqual({ authExpired: true })
        expect(firestoreUpdate).toHaveBeenCalledWith(update)

        const getSummaryAfterPersistence = jest.fn()
        await expect(
            getEmailLineSummaryResponse({
                userId: 'legacy-user',
                key: 'project-1',
                userData: { ...userData, ...update },
                getSummary: getSummaryAfterPersistence,
                persistAuthInvalid: jest.fn(),
            })
        ).resolves.toEqual({ authExpired: true })
        expect(getSummaryAfterPersistence).not.toHaveBeenCalled()
    })

    test('short-circuits an already-invalid connection until reconnect clears the flag', async () => {
        const userData = {
            emailConnections: {
                [accountConnectionId]: {
                    provider: 'google',
                    emailAddress: accountEmail,
                    defaultProjectId: 'project-1',
                    authInvalid: true,
                },
            },
        }
        const getSummary = jest.fn()
        const persistAuthInvalid = jest.fn()

        await expect(
            getEmailLineSummaryResponse({
                userId: 'user-1',
                key: accountConnectionId,
                userData,
                getSummary,
                persistAuthInvalid,
            })
        ).resolves.toEqual({ authExpired: true })
        expect(getSummary).not.toHaveBeenCalled()
        expect(persistAuthInvalid).not.toHaveBeenCalled()
    })

    test('keeps non-auth summary failures visible', async () => {
        const failure = new Error('Provider unavailable')
        await expect(
            getEmailLineSummaryResponse({
                userId: 'user-1',
                key: accountConnectionId,
                userData: {},
                getSummary: jest.fn().mockRejectedValue(failure),
                persistAuthInvalid: jest.fn(),
            })
        ).rejects.toBe(failure)
    })

    test('still returns authExpired if persisting the circuit breaker temporarily fails', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        await expect(
            getEmailLineSummaryResponse({
                userId: 'user-1',
                key: accountConnectionId,
                userData: {},
                getSummary: jest.fn().mockRejectedValue(new EmailLineAuthError()),
                persistAuthInvalid: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
            })
        ).resolves.toEqual({ authExpired: true })
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })
})
