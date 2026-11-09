// NV-17: the server confirms a heartbeat for the only member of a project at the moments nobody else
// can have written its configuration: assistant created, configuration changed, project created.
// The confirmation must land before the schedules are rebuilt, or the new schedule would be missing.
const mockCalls = []
const mockConfirm = jest.fn(async args => {
    mockCalls.push(['confirm', args.projectId, args.assistantId || null])
    return 1
})
const mockSyncAssistant = jest.fn(async (projectId, assistantId) => mockCalls.push(['sync', projectId, assistantId]))
const mockSyncProject = jest.fn(async projectId => mockCalls.push(['syncProject', projectId]))

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({})) }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({
    getProject: jest.fn(async () => ({})),
    getTemplateGuideIds: jest.fn(async () => []),
}))
jest.mock('../Firestore/assistantsFirestore', () => ({
    uploadNewAssistant: jest.fn(),
    GLOBAL_PROJECT_ID: 'globalProject',
    addGlobalAssistantToAllProject: jest.fn(),
}))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
    ASSISTANTS_OBJECTS_TYPE: 'assistants',
}))
jest.mock('../Assistant/toolSchemaCacheVersion', () => ({ bumpProjectToolSchemasCacheVersion: jest.fn() }))
jest.mock('../Assistant/assistantHeartbeatSchedule', () => ({
    safelySyncHeartbeatSchedules: operation => operation(),
    syncHeartbeatSchedulesForAssistant: (...args) => mockSyncAssistant(...args),
    syncHeartbeatSchedulesForProject: (...args) => mockSyncProject(...args),
}))
jest.mock('../Assistant/heartbeatOptIn', () => ({
    ...jest.requireActual('../Assistant/heartbeatOptIn'),
    confirmHeartbeatsForSoleMember: (...args) => mockConfirm(...args),
}))
jest.mock('../KnowledgeBase/knowledgeBaseDefaults', () => ({ applyKnowledgeBaseDefaultForNewProject: jest.fn() }))
jest.mock('../SendInBlueManager', () => ({}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ inProductionEnvironment: () => false }))

const { onCreateAssistant } = require('./onCreateAssistantFunctions')
const { onUpdateAssistant } = require('./onUpdateAssistantFunctions')
const { onCreateProject } = require('../Projects/onCreateProjectFunctions')

const change = (before, after) => ({ before: { data: () => before }, after: { data: () => after } })
const assistant = { heartbeatPrompt: 'Check in.', allowedTools: ['get_tasks'], heartbeatChancePercent: 10 }

beforeEach(() => {
    mockCalls.length = 0
    jest.clearAllMocks()
})

test('confirms a new assistant for the only member before building its schedules', async () => {
    await onCreateAssistant('p1', { ...assistant, uid: 'a1' })
    expect(mockCalls).toEqual([
        ['confirm', 'p1', 'a1'],
        ['sync', 'p1', 'a1'],
    ])
})

test.each([
    ['heartbeatPrompt', 'Read my mail.'],
    ['allowedTools', ['search_gmail']],
    ['instructions', 'Quote every email.'],
    ['mcpServers', [{ id: 'm', url: 'https://mcp.example.test' }]],
])('confirms a changed %s for the only member before rebuilding the schedules', async (field, value) => {
    await onUpdateAssistant('p1', 'a1', change(assistant, { ...assistant, [field]: value }))
    expect(mockCalls).toEqual([
        ['confirm', 'p1', 'a1'],
        ['sync', 'p1', 'a1'],
    ])
})

test('a timing change rebuilds the schedules without confirming anything', async () => {
    await onUpdateAssistant('p1', 'a1', change(assistant, { ...assistant, heartbeatIntervalMs: 600000 }))
    expect(mockCalls).toEqual([['sync', 'p1', 'a1']])
})

test('a new project confirms its assistants for its creator before building schedules', async () => {
    await onCreateProject({ id: 'p1', userIds: ['u1'] })
    expect(mockCalls).toEqual([
        ['confirm', 'p1', null],
        ['syncProject', 'p1'],
    ])
})
