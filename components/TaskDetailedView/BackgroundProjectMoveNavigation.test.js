jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({ watchTask: jest.fn() }))
jest.mock('../../utils/backends/firestore', () => ({ getTaskData: jest.fn(), unwatch: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getTypeOfProject: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    resetFloatPopup: jest.fn(),
    setSelectedSidebarTab: jest.fn(),
    setSelectedTypeOfProject: jest.fn(),
    showConfirmPopup: jest.fn(),
    switchProject: jest.fn(),
}))
jest.mock('../UIComponents/ConfirmPopup', () => ({ CONFIRM_POPUP_TRIGGER_INFO: 'INFO' }))
jest.mock('../../URLSystem/Tasks/URLsTasks', () => ({
    __esModule: true,
    default: { replace: jest.fn() },
    URL_TASK_DETAILS_BACKLINKS_NOTES: 'backlinks-notes',
    URL_TASK_DETAILS_BACKLINKS_TASKS: 'backlinks-tasks',
    URL_TASK_DETAILS_CHAT: 'chat',
    URL_TASK_DETAILS_ESTIMATION: 'estimation',
    URL_TASK_DETAILS_FEED: 'updates',
    URL_TASK_DETAILS_NOTE: 'note',
    URL_TASK_DETAILS_PROPERTIES: 'properties',
    URL_TASK_DETAILS_SUBTASKS: 'subtasks',
    REPLACE_NEXT_TASK_DETAIL_PUSH: '__replaceNextTaskDetailPush',
}))

import { getTaskMoveHandoffUrl, taskMatchesProjectMove } from './useTaskProjectMoveHandoff'
import {
    URL_TASK_DETAILS_BACKLINKS_NOTES,
    URL_TASK_DETAILS_BACKLINKS_TASKS,
    URL_TASK_DETAILS_CHAT,
    URL_TASK_DETAILS_PROPERTIES,
} from '../../URLSystem/Tasks/URLsTasks'
import { DV_TAB_TASK_BACKLINKS, DV_TAB_TASK_CHAT, DV_TAB_TASK_PROPERTIES } from '../../utils/TabNavigationConstants'

describe('AT-2533 moved task detailed-view handoff', () => {
    const handoff = {
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        requestId: 'request-1',
    }

    it('only accepts the completed destination created by this move', () => {
        expect(
            taskMatchesProjectMove(
                {
                    projectMove: {
                        sourceProjectId: 'project-a',
                        targetProjectId: 'project-b',
                        requestId: 'request-1',
                        status: 'completed',
                    },
                },
                handoff,
                'completed'
            )
        ).toBe(true)
        expect(
            taskMatchesProjectMove(
                {
                    projectMove: {
                        sourceProjectId: 'project-a',
                        targetProjectId: 'project-b',
                        requestId: 'another-request',
                        status: 'completed',
                    },
                },
                handoff,
                'completed'
            )
        ).toBe(false)
    })

    it('preserves the open DV tab, including both backlinks routes', () => {
        expect(getTaskMoveHandoffUrl(DV_TAB_TASK_PROPERTIES)).toBe(URL_TASK_DETAILS_PROPERTIES)
        expect(getTaskMoveHandoffUrl(DV_TAB_TASK_CHAT)).toBe(URL_TASK_DETAILS_CHAT)
        expect(getTaskMoveHandoffUrl(DV_TAB_TASK_BACKLINKS, '/projects/a/tasks/t/backlinks/tasks')).toBe(
            URL_TASK_DETAILS_BACKLINKS_TASKS
        )
        expect(getTaskMoveHandoffUrl(DV_TAB_TASK_BACKLINKS, '/projects/a/tasks/t/backlinks/notes')).toBe(
            URL_TASK_DETAILS_BACKLINKS_NOTES
        )
    })
})
