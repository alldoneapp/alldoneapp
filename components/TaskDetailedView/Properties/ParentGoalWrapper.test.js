/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ParentGoalWrapper from './ParentGoalWrapper'
import { setTaskParentGoal, setTaskProjectWithGoal } from '../../../utils/backends/Tasks/tasksFirestore'
import Backend from '../../../utils/BackendBridge'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ smallScreenNavigation: false }) }))
jest.mock('uuid/v4', () => () => 'goal-watcher')
jest.mock('../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ content, children }) => (
        <View testID="parent-goal-popover">
            {children}
            {content}
        </View>
    )
})
jest.mock('./ParentGoalButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="parent-goal-button" {...props} />
})
jest.mock('../../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="parent-goal-modal" {...props} />
})
jest.mock('../../ModalsManager/modalsManager', () => ({
    exitsOpenModals: () => false,
    PRIVACY_MODAL_ID: 'privacy',
    TASK_PARENT_GOAL_MODAL_ID: 'parent-goal',
}))
jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        watchGoal: jest.fn(),
        unwatch: jest.fn(),
    },
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskParentGoal: jest.fn(),
    setTaskProjectWithGoal: jest.fn(),
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getProjectById: jest.fn(),
    },
}))

const TASK = { id: 'task-1', userId: 'user-1', parentGoalId: null }
const GOAL = { id: 'goal-1', projectId: 'project-1', extendedName: 'Launch', isPublicFor: [0] }

const renderWrapper = (task = TASK, projectId = 'project-1') => {
    let tree
    act(() => {
        tree = renderer.create(<ParentGoalWrapper projectId={projectId} task={task} disabled={false} />)
    })
    return tree
}

describe('ParentGoalWrapper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        setTaskParentGoal.mockResolvedValue({ parentGoalId: GOAL.id })
        setTaskProjectWithGoal.mockResolvedValue(undefined)
    })

    it('waits for the parent-goal write before showing the selected goal', async () => {
        let finishWrite
        setTaskParentGoal.mockReturnValue(
            new Promise(resolve => {
                finishWrite = resolve
            })
        )
        const tree = renderWrapper()
        const modal = tree.root.findByProps({ testID: 'parent-goal-modal' })

        let selection
        await act(async () => {
            selection = modal.props.setActiveGoal(GOAL, GOAL.projectId)
            await Promise.resolve()
        })

        expect(setTaskParentGoal).toHaveBeenCalledWith('project-1', TASK.id, TASK, GOAL)
        expect(tree.root.findByProps({ testID: 'parent-goal-button' }).props.activeGoal).toBeNull()

        await act(async () => {
            finishWrite()
            await selection
        })

        expect(tree.root.findByProps({ testID: 'parent-goal-button' }).props.activeGoal).toBe(GOAL)
    })

    it('uses the destination project path and reports a missing destination as unsaved', async () => {
        const currentProject = { id: 'project-1' }
        const destinationProject = { id: 'project-2' }
        const otherGoal = { ...GOAL, id: 'goal-2', projectId: destinationProject.id }
        ProjectHelper.getProjectById.mockImplementation(id =>
            id === currentProject.id ? currentProject : id === destinationProject.id ? destinationProject : null
        )
        const tree = renderWrapper(TASK, currentProject.id)
        const modal = tree.root.findByProps({ testID: 'parent-goal-modal' })

        await act(async () => {
            await modal.props.setActiveGoal(otherGoal, destinationProject.id)
        })

        expect(setTaskProjectWithGoal).toHaveBeenCalledWith(currentProject, destinationProject, TASK, otherGoal)
        expect(setTaskParentGoal).not.toHaveBeenCalled()

        ProjectHelper.getProjectById.mockReturnValue(null)
        await expect(modal.props.setActiveGoal(otherGoal, destinationProject.id)).resolves.toBe(false)
    })

    it('unsubscribes the actual goal watcher key', () => {
        Backend.watchGoal.mockImplementation((projectId, goalId, watcherKey, callback) => callback(GOAL))
        const tree = renderWrapper({ ...TASK, parentGoalId: GOAL.id })

        act(() => {
            tree.unmount()
        })

        expect(Backend.unwatch).toHaveBeenCalledWith('goal-watcher')
    })
})
