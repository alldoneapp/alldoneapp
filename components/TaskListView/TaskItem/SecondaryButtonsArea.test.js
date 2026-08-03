import React from 'react'
import renderer from 'react-test-renderer'

import SecondaryButtonsArea from './SecondaryButtonsArea'
import ExecutionModeButton from './ExecutionModeButton'

const mockState = {
    smallScreen: false,
    loggedUser: { uid: 'user-1', inFocusTaskId: null },
    taskViewToggleSection: 'Tasks',
    optimisticFocusTaskId: null,
    optimisticFocusActive: false,
    blockShortcuts: false,
}

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('react-tiny-popover', () => 'Popover')
jest.mock('react-hot-keys', () => 'Hotkeys')
jest.mock('../../UIComponents/FloatModals/PrivacyModal/PrivacyButton', () => 'PrivacyButton')
jest.mock('../../UIComponents/FloatModals/HighlightColorModal/HighlightButton', () => 'HighlightButton')
jest.mock('../../UIComponents/FloatModals/MorePopupsOfEditModals/Tasks/TaskMoreButton', () => 'TaskMoreButton')
jest.mock('../../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal', () => 'TaskParentGoalModal')
jest.mock('../../UIControls/DueDateButton', () => 'DueDateButton')
jest.mock('../../UIControls/CommentButton', () => 'CommentButton')
jest.mock('../../UIControls/FollowUpButton', () => 'FollowUpButton')
jest.mock('../../UIControls/TranscribeButton', () => 'TranscribeButton')
jest.mock('../../UIControls/GhostButton', () => 'GhostButton')
jest.mock('./OpenDvButton', () => 'OpenDvButton')
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({ updateFocusedTask: jest.fn() }))
jest.mock('../../../utils/HelperFunctions', () => ({
    execShortcutFn: jest.fn(),
    popoverToTop: jest.fn(),
}))
jest.mock('../../../utils/BackendBridge', () => ({ getGoalData: jest.fn() }))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({ objectIsPublicForLoggedUser: jest.fn() }))
jest.mock('../../../utils/Gmail/gmailTaskUtils', () => ({ isInboxSummaryGmailTask: jest.fn(() => false) }))
jest.mock('../../../utils/taskFocusInteraction', () => ({ prepareTaskFocusChange: jest.fn() }))
jest.mock('../../../hooks/useFloatPopupLock', () => () => ({ acquire: jest.fn(), release: jest.fn() }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

describe('SecondaryButtonsArea', () => {
    test('does not offer workflow bypass while adding an inline task', () => {
        const tree = renderer.create(
            <SecondaryButtonsArea
                tmpTask={{ done: false, calendarData: null, parentGoalId: null }}
                hasName={true}
                adding={true}
                projectId="project-1"
                accessGranted={true}
                loggedUserCanUpdateObject={false}
            />
        )

        expect(tree.root.findAllByType(ExecutionModeButton)).toHaveLength(0)
    })
})
