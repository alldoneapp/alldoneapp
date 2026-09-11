jest.mock('../URLSystem', () => ({
    __esModule: true,
    default: { setLastNavigationScreen: jest.fn() },
}))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectNameById: () => 'Project',
    getUserNameById: () => 'User',
}))
jest.mock('../../components/Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'ws@default',
    WORKSTREAM_ID_PREFIX: 'ws@',
    getWorkstreamById: jest.fn(),
}))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: jest.fn() }))
jest.mock('../../utils/HelperFunctions', () => ({ getFirstName: value => value }))

import URLsTasks, { REPLACE_NEXT_TASK_DETAIL_PUSH, URL_TASK_DETAILS_CHAT } from './URLsTasks'

describe('task detail history replacement', () => {
    it('consumes the handoff marker instead of pushing a duplicate destination route', () => {
        const pushSpy = jest.spyOn(history, 'pushState')
        const replaceSpy = jest.spyOn(history, 'replaceState')

        URLsTasks.replace(
            URL_TASK_DETAILS_CHAT,
            {
                projectId: 'project-b',
                task: 'task-1',
                [REPLACE_NEXT_TASK_DETAIL_PUSH]: true,
            },
            'project-b',
            'task-1'
        )
        pushSpy.mockClear()
        replaceSpy.mockClear()

        URLsTasks.push(URL_TASK_DETAILS_CHAT, { projectId: 'project-b', task: 'task-1' }, 'project-b', 'task-1')

        expect(pushSpy).not.toHaveBeenCalled()
        expect(replaceSpy).toHaveBeenCalledTimes(1)
        expect(history.state).toEqual({ projectId: 'project-b', task: 'task-1' })

        pushSpy.mockRestore()
        replaceSpy.mockRestore()
    })
})
