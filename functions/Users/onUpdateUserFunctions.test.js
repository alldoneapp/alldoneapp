const mockUpdateUserRecord = jest.fn()
const mockGenerateUserWarnings = jest.fn()

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    updateUserRecord: (...args) => mockUpdateUserRecord(...args),
}))
jest.mock('../Payment/QuotaWarnings', () => ({
    generateUserWarnings: (...args) => mockGenerateUserWarnings(...args),
}))
jest.mock('../Skills/automaticSkillPointDistribution', () => ({
    processAutomaticSkillPointDistribution: jest.fn(),
}))
jest.mock('../Assistant/assistantHeartbeatSchedule', () => ({
    ACTIVE_USER_WINDOW_MS: 30 * 24 * 60 * 60 * 1000,
    getTimestampMillis: value => Number(value) || 0,
    safelySyncHeartbeatSchedules: jest.fn(),
    syncHeartbeatSchedulesForUser: jest.fn(),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: jest.fn() } }))

const { onUpdateUser, searchIndexedFieldsChanged } = require('./onUpdateUserFunctions')

const change = (before, after) => ({ before: { data: () => before }, after: { data: () => after } })
const baseUser = {
    displayName: 'Ada',
    photoURL: 'https://example.com/a.png',
    extendedDescription: 'Engineer',
    projectIds: ['p1', 'p2'],
    lastLogin: 1000,
    gold: 10,
    xp: 5,
}

beforeEach(() => {
    mockUpdateUserRecord.mockReset()
    mockGenerateUserWarnings.mockReset()
})

describe('search re-index guard', () => {
    test('a lastLogin / gold / xp write does not re-send the user to the search index', async () => {
        await onUpdateUser('u1', change(baseUser, { ...baseUser, lastLogin: 2000, gold: 40, xp: 9 }))
        expect(mockUpdateUserRecord).not.toHaveBeenCalled()
        expect(mockGenerateUserWarnings).toHaveBeenCalledTimes(1)
    })

    test.each([
        ['displayName', 'Ada L.'],
        ['photoURL', 'https://example.com/b.png'],
        ['extendedDescription', 'Staff engineer'],
        ['description', 'short'],
        ['isPrivate', true],
        ['isPublicFor', ['u1']],
        ['projectIds', ['p1']],
        ['lastEditionDate', 5],
        ['company', 'Acme'],
        ['role', 'CTO'],
    ])('a change to %s re-indexes the user', async (field, value) => {
        await onUpdateUser('u1', change(baseUser, { ...baseUser, [field]: value }))
        expect(mockUpdateUserRecord).toHaveBeenCalledTimes(1)
    })

    test('array fields are compared by value, not identity', () => {
        expect(searchIndexedFieldsChanged({ projectIds: ['a', 'b'] }, { projectIds: ['a', 'b'] })).toBe(false)
        expect(searchIndexedFieldsChanged({ projectIds: ['a', 'b'] }, { projectIds: ['b', 'a'] })).toBe(true)
        expect(searchIndexedFieldsChanged({}, { company: '' })).toBe(true)
    })
})
