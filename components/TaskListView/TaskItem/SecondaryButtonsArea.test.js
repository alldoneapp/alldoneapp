import React from 'react'
import renderer, { act } from 'react-test-renderer'

import SecondaryButtonsArea from './SecondaryButtonsArea'
import ExecutionModeButton from './ExecutionModeButton'
import { colors } from '../../styles/global'
import { updateFocusedTask } from '../../../utils/backends/Tasks/tasksFirestore'
import { prepareTaskFocusChange } from '../../../utils/taskFocusInteraction'

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
    beforeEach(() => {
        jest.clearAllMocks()
    })

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

    test('starts a new inline task deselected and toggles focus selection on and off', () => {
        const InlineTaskFocusHarness = () => {
            const [newTaskInFocus, setNewTaskInFocus] = React.useState(false)

            return (
                <SecondaryButtonsArea
                    tmpTask={{
                        done: false,
                        calendarData: null,
                        parentGoalId: null,
                        parentGoalIsPublicFor: [0],
                        isSubtask: false,
                        userId: 'user-1',
                    }}
                    hasName={true}
                    adding={true}
                    projectId="project-1"
                    accessGranted={true}
                    loggedUserCanUpdateObject={true}
                    newTaskInFocus={newTaskInFocus}
                    setNewTaskInFocus={setNewTaskInFocus}
                />
            )
        }

        const tree = renderer.create(<InlineTaskFocusHarness />)
        const getFocusButton = () =>
            tree.root.findAllByType('GhostButton').find(button => button.props.icon === 'crosshair')

        expect(getFocusButton().props.title).toBe('Set in focus')
        expect(getFocusButton().props.iconColor).toBe(colors.Text03)
        expect(getFocusButton().props.buttonStyle.backgroundColor).toBeUndefined()

        act(() => getFocusButton().props.onPress())

        expect(getFocusButton().props.title).toBe('Set out of focus')
        expect(getFocusButton().props.iconColor).toBe(colors.Primary100)
        expect(getFocusButton().props.buttonStyle.backgroundColor).toBe(colors.Primary050)

        act(() => getFocusButton().props.onPress())

        expect(getFocusButton().props.title).toBe('Set in focus')
        expect(getFocusButton().props.iconColor).toBe(colors.Text03)
        expect(getFocusButton().props.buttonStyle.backgroundColor).toBeUndefined()
        expect(prepareTaskFocusChange).not.toHaveBeenCalled()
        expect(updateFocusedTask).not.toHaveBeenCalled()
    })
})
