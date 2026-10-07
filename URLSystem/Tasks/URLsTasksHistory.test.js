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
import { setAnnaMode } from '../../utils/annaMode'

describe('task detail history replacement', () => {
    afterEach(() => window.history.replaceState(null, '', '/'))

    it('preserves assistant mode when replacing or pushing a task route', () => {
        setAnnaMode(true)
        URLsTasks.replace(URL_TASK_DETAILS_CHAT, { task: 'task-1' }, 'project-a', 'task-1')
        expect(window.location.pathname).toBe('/projects/project-a/tasks/task-1/chat')
        expect(window.location.search).toBe('?assistant=1')
        URLsTasks.push(URL_TASK_DETAILS_CHAT, { task: 'task-2' }, 'project-a', 'task-2')
        expect(window.location.pathname).toBe('/projects/project-a/tasks/task-2/chat')
        expect(window.location.search).toBe('?assistant=1')
        expect(history.state).toEqual({ task: 'task-2' })
    })

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
