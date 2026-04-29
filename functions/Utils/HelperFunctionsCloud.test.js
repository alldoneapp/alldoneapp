let mockParamValues = {}

jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(name => ({
            value: jest.fn(() => mockParamValues[name] || ''),
        })),
    }),
    { virtual: true }
)

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({ options: {} })),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({})),
}))

describe('HelperFunctionsCloud environment helpers', () => {
    const originalEnv = process.env

    beforeEach(() => {
        jest.resetModules()
        mockParamValues = {}
        process.env = { ...originalEnv }
        delete process.env.FUNCTIONS_EMULATOR
        delete process.env.GCLOUD_PROJECT
        delete process.env.GCP_PROJECT
        delete process.env.GOOGLE_CLOUD_PROJECT
        delete process.env.FIREBASE_CONFIG
        delete process.env.CURRENT_ENVIORNMENT
        delete process.env.CURRENT_ENVIRONMENT
    })

    afterAll(() => {
        process.env = originalEnv
    })

    test('uses production URL when running in the production Firebase project', () => {
        process.env.GCLOUD_PROJECT = 'alldonealeph'

        const { getBaseUrl, inProductionEnvironment } = require('./HelperFunctionsCloud')

        expect(inProductionEnvironment()).toBe(true)
        expect(getBaseUrl()).toBe('https://my.alldone.app')
    })

    test('lets the runtime project ID override a missing or stale environment param', () => {
        process.env.GCLOUD_PROJECT = 'alldonealeph'
        mockParamValues.CURRENT_ENVIORNMENT = ''

        const { getBaseUrl } = require('./HelperFunctionsCloud')

        expect(getBaseUrl()).toBe('https://my.alldone.app')
    })

    test('derives production URL from FIREBASE_CONFIG when project env vars are absent', () => {
        process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'alldonealeph' })

        const { getBaseUrl, inProductionEnvironment } = require('./HelperFunctionsCloud')

        expect(inProductionEnvironment()).toBe(true)
        expect(getBaseUrl()).toBe('https://my.alldone.app')
    })

    test('uses staging URL when running in the staging Firebase project', () => {
        process.env.GCLOUD_PROJECT = 'alldonestaging'
        mockParamValues.CURRENT_ENVIORNMENT = 'Production'

        const { getBaseUrl, inProductionEnvironment } = require('./HelperFunctionsCloud')

        expect(inProductionEnvironment()).toBe(false)
        expect(getBaseUrl()).toBe('https://mystaging.alldone.app')
    })
})
