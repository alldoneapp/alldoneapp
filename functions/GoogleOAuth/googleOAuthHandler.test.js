jest.mock('firebase-admin', () => ({
    firestore: {
        Timestamp: {
            now: jest.fn(),
            fromDate: jest.fn(),
            fromMillis: jest.fn(),
        },
        FieldValue: {
            delete: jest.fn(),
        },
    },
    app: jest.fn(() => ({
        options: {
            projectId: 'alldonealeph',
        },
    })),
}))

jest.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: jest.fn(),
        },
    },
}))

jest.mock('../envFunctionsHelper.js', () => ({
    getEnvFunctions: jest.fn(() => ({
        GOOGLE_OAUTH_CLIENT_ID: 'client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    })),
}))

const { __private__ } = require('./googleOAuthHandler')

describe('googleOAuthHandler default connection helpers', () => {
    test('detects when no default connection exists', () => {
        expect(__private__.hasExistingDefaultConnection({}, 'calendarDefault')).toBe(false)
        expect(
            __private__.hasExistingDefaultConnection(
                {
                    p1: { calendar: true, calendarDefault: false },
                    p2: { calendar: true },
                },
                'calendarDefault'
            )
        ).toBe(false)
    })

    test('detects existing default calendar and gmail connections', () => {
        expect(
            __private__.hasExistingDefaultConnection(
                {
                    p1: { calendar: true, calendarDefault: true },
                    p2: { calendar: true, calendarDefault: false },
                },
                'calendarDefault'
            )
        ).toBe(true)

        expect(
            __private__.hasExistingDefaultConnection(
                {
                    p1: { gmail: true, gmailDefault: false },
                    p2: { gmail: true, gmailDefault: true },
                },
                'gmailDefault'
            )
        ).toBe(true)
    })
})
