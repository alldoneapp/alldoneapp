import React from 'react'
import TaskTitle from '../../../components/TaskDetailedView/Header/TaskTitle'

import renderer, { act } from 'react-test-renderer'

jest.mock('expo-localization', () => ({ locale: 'en-US', getLocales: () => [{ languageCode: 'en' }] }))
jest.mock('firebase', () => ({ firestore: {} }))
jest.mock('../../../utils/BackendBridge', () => ({}))
jest.mock('../../../redux/store', () => ({
    getState: () => ({
        selectedNavItem: 'TASK_CHAT',
        taskTitleInEditMode: false,
        loggedUser: { uid: 'user-1' },
    }),
    subscribe: () => jest.fn(),
    dispatch: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({
    setTaskTitleInEditMode: value => ({ type: 'SET_TASK_TITLE_IN_EDIT_MODE', value }),
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfLoggedUserIsNormalUserInGuide: () => false,
}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskName: jest.fn(),
}))
jest.mock('../../../utils/Gmail/gmailTaskUtils', () => ({
    isGmailLabelFollowUpTask: () => false,
}))
jest.mock('../../../components/Tags/GmailTag', () => {
    const React = require('react')
    const { View } = require('react-native')

    return props => <View {...props} />
})
jest.mock('../../../components/SocialTextInput', () => {
    const React = require('react')
    const { Text } = require('react-native')

    return props => <Text>{props.value}</Text>
})

describe('TaskTitle component', () => {
    const task = {
        id: 'task-1',
        userId: 'user-1',
        linkBack: [],
    }

    describe('TaskTitle snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <TaskTitle hashtags={['asd', 'dsa']} projectId="project-1" task={task} title="dsa" object={task} />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('renders the ellipsis after the title exceeds the collapsed height', () => {
            const tree = renderer.create(
                <TaskTitle hashtags={['asd', 'dsa']} projectId="project-1" task={task} title="dsa" object={task} />
            )
            const taskTitle = tree.root.findByType(TaskTitle).instance

            act(() => {
                taskTitle.onTitleLayoutChange({ nativeEvent: { layout: { height: 900 } } })
            })

            expect(taskTitle.state.showEllipsis).toBe(true)
            expect(JSON.stringify(tree.toJSON())).toContain('...')
        })
    })
})
