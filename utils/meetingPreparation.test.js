import { startMeetingPreparation } from './meetingPreparation'
import { createObjectMessage } from './backends/Chats/chatsComments'
import { createBotQuickTopic } from './assistantHelper'
import { resolveDefaultAssistantForProject } from '../components/AdminPanel/Assistants/assistantsHelper'
import { STAYWARD_COMMENT } from '../components/Feeds/Utils/HelperFunctions'
import { setLanguage } from '../i18n/TranslationService'

jest.mock('./backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn() }))
jest.mock('./assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
jest.mock('../components/Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 2 }))
jest.mock('../components/AdminPanel/Assistants/assistantsHelper', () => ({
    resolveDefaultAssistantForProject: jest.fn(),
}))

const assistant = { uid: 'project-assistant', displayName: 'CTO' }
const meeting = id => ({ id, assistantId: 'task-assistant', calendarData: { start: { date: '2026-10-05' } } })
const request = { projectId: 'project-1', tasks: [meeting('event-1')], specificTask: true }
const settle = () => createObjectMessage.mock.calls.forEach(call => call[10]())

beforeEach(() => {
    jest.clearAllMocks()
    setLanguage('en')
    global.alert = jest.fn()
    resolveDefaultAssistantForProject.mockReturnValue(assistant)
    createObjectMessage.mockResolvedValue('message-1')
})
afterEach(() => {
    settle()
    expect(createBotQuickTopic).not.toHaveBeenCalled()
})

it('submits a compact request in the calendar task thread using the project assistant', async () => {
    expect(await startMeetingPreparation(request)).toEqual(['message-1'])
    expect(resolveDefaultAssistantForProject).toHaveBeenCalledWith('project-1')
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
    expect(createObjectMessage).toHaveBeenCalledWith(
        'project-1',
        'event-1',
        expect.stringContaining('event-1'),
        'tasks',
        STAYWARD_COMMENT,
        null,
        null,
        false,
        true,
        assistant.uid,
        expect.any(Function)
    )
    expect(createObjectMessage.mock.calls[0][2]).not.toMatch(/[{}]/)
})

it('queues exactly one request per displayed calendar task, preserving destination and private-task data', async () => {
    const first = { ...meeting('event-1'), isPublicFor: ['owner'], isPrivate: true }
    const second = { ...meeting('event-2'), calendarData: { originalProjectId: 'source-project' } }
    const tasks = [first, second, first, { id: 'ordinary-task' }, null, { calendarData: {} }]
    const original = JSON.stringify(tasks)
    await startMeetingPreparation({ projectId: 'project-1', tasks })
    expect(createObjectMessage.mock.calls.map(call => [call[0], call[1], call[3]])).toEqual([
        ['project-1', 'event-1', 'tasks'],
        ['project-1', 'event-2', 'tasks'],
    ])
    expect(createObjectMessage.mock.calls[0][2]).not.toContain('event-2')
    expect(createObjectMessage.mock.calls[1][2]).not.toContain('event-1')
    expect(JSON.stringify(tasks)).toBe(original)
})

it('deduplicates overlapping bulk and single requests until the assistant run settles', async () => {
    let finish
    createObjectMessage.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const first = startMeetingPreparation({ projectId: 'project-1', tasks: [meeting('event-1'), meeting('event-2')] })
    expect(await startMeetingPreparation({ ...request, tasks: [meeting('event-2')] })).toBeNull()
    finish('message-1')
    await first
    // Local queue acceptance does not mean the assistant has finished.
    expect(await startMeetingPreparation(request)).toBeNull()
    expect(createObjectMessage).toHaveBeenCalledTimes(2)
    createObjectMessage.mock.calls[0][10]({ status: 'completed' })
    await startMeetingPreparation(request)
    expect(createObjectMessage).toHaveBeenCalledTimes(3)
})

it('submits only newly selected tasks when a bulk action overlaps a running single action', async () => {
    await startMeetingPreparation(request)
    await startMeetingPreparation({ projectId: 'project-1', tasks: [meeting('event-2'), meeting('event-1')] })
    expect(createObjectMessage.mock.calls.map(call => call[1])).toEqual(['event-1', 'event-2'])
})

it('keeps duplicate guards scoped to the destination project, including global assistants', async () => {
    resolveDefaultAssistantForProject.mockReturnValue({ uid: 'global-assistant' })
    await startMeetingPreparation(request)
    await startMeetingPreparation({ ...request, projectId: 'project-2' })
    expect(createObjectMessage.mock.calls.map(call => [call[0], call[1], call[9]])).toEqual([
        ['project-1', 'event-1', 'global-assistant'],
        ['project-2', 'event-1', 'global-assistant'],
    ])
})

it.each([{}, { tasks: [] }, { tasks: [{ id: 'ordinary' }] }, { projectId: '' }])(
    'ignores requests without a destination or saved calendar tasks: %j',
    async overrides => {
        await startMeetingPreparation(
            overrides.tasks === undefined && !('projectId' in overrides)
                ? { projectId: 'project-1' }
                : { ...request, ...overrides }
        )
        expect(createObjectMessage).not.toHaveBeenCalled()
    }
)

it('explains missing project assistants instead of using the task-assigned assistant', async () => {
    resolveDefaultAssistantForProject.mockReturnValue(null)
    expect(await startMeetingPreparation(request)).toBeNull()
    expect(createObjectMessage).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('No project assistant'))
})

it('continues a bulk action after a failed submission and retries only the failed destination', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
        createObjectMessage.mockRejectedValueOnce(new Error('permission-denied'))
        const bulk = { projectId: 'project-1', tasks: [meeting('event-1'), meeting('event-2')] }
        expect(await startMeetingPreparation(bulk)).toEqual(['message-1'])
        expect(alert).toHaveBeenCalledTimes(1)
        expect(alert).toHaveBeenCalledWith(expect.stringContaining('could not start'))
        await startMeetingPreparation(bulk)
        expect(createObjectMessage.mock.calls.map(call => call[1])).toEqual(['event-1', 'event-2', 'event-1'])
    } finally {
        log.mockRestore()
    }
})

it('releases the guard on an empty queue result or a failed assistant run', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
        createObjectMessage.mockResolvedValueOnce(null)
        expect(await startMeetingPreparation(request)).toBeNull()
        await startMeetingPreparation(request)
        createObjectMessage.mock.calls[1][10]({ status: 'failed' })
        await startMeetingPreparation(request)
        expect(createObjectMessage).toHaveBeenCalledTimes(3)
    } finally {
        log.mockRestore()
    }
})
