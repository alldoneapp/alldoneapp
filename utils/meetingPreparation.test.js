import { startMeetingPreparation } from './meetingPreparation'
import { createBotQuickTopic } from './assistantHelper'
import { resolveDefaultAssistantForProject } from '../components/AdminPanel/Assistants/assistantsHelper'

jest.mock('./assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
jest.mock('../components/AdminPanel/Assistants/assistantsHelper', () => ({
    resolveDefaultAssistantForProject: jest.fn(),
}))
jest.mock('../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: () => ({ name: 'Product' }),
}))

const assistant = { uid: 'project-assistant', displayName: 'CTO' }
const request = {
    projectId: 'project-1',
    tasks: [{ id: 'event-1', calendarData: { start: { date: '2026-10-05' } } }],
    specificTask: true,
}

beforeEach(() => {
    jest.clearAllMocks()
    global.alert = jest.fn()
    resolveDefaultAssistantForProject.mockReturnValue(assistant)
    createBotQuickTopic.mockResolvedValue({ chatId: 'new-chat' })
})

it('starts a new chat with the project assistant and submits context in the current project', async () => {
    expect(await startMeetingPreparation(request)).toEqual({ chatId: 'new-chat' })
    expect(resolveDefaultAssistantForProject).toHaveBeenCalledWith('project-1')
    expect(createBotQuickTopic).toHaveBeenCalledWith(assistant, expect.stringContaining('event-1'), {
        projectId: 'project-1',
        enableAssistant: true,
        skipNavigation: false,
    })
})

it('blocks duplicate pending requests but allows a new chat once creation completes', async () => {
    let finish
    createBotQuickTopic.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const first = startMeetingPreparation(request)
    expect(await startMeetingPreparation(request)).toBeNull()
    finish({ chatId: 'first' })
    await first
    await startMeetingPreparation(request)
    expect(createBotQuickTopic).toHaveBeenCalledTimes(2)
})

it('does not create an empty briefing chat', async () => {
    await startMeetingPreparation({ ...request, tasks: [] })
    expect(createBotQuickTopic).not.toHaveBeenCalled()
})

it('explains missing assistants instead of starting a chat with a task-assigned assistant', async () => {
    resolveDefaultAssistantForProject.mockReturnValue(null)
    await startMeetingPreparation(request)
    expect(createBotQuickTopic).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('No project assistant'))
})

it('shows a failure and allows a retry when chat creation fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
        createBotQuickTopic.mockRejectedValueOnce(new Error('offline'))
        expect(await startMeetingPreparation(request)).toBeNull()
        expect(alert).toHaveBeenCalledWith(expect.stringContaining('could not start'))
        expect(await startMeetingPreparation(request)).toEqual({ chatId: 'new-chat' })
    } finally {
        log.mockRestore()
    }
})
