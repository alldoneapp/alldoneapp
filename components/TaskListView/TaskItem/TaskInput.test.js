import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'

import TaskInput from './TaskInput'

const mockInputFocus = jest.fn()
const mockState = {
    isMiddleScreen: false,
    currentUser: { uid: 'user-1' },
    loggedUser: { uid: 'user-1' },
}

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')

    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ focus: mockInputFocus }))
        return React.createElement('CustomTextInput3', props)
    })
})
jest.mock('../../Feeds/CommentsTextInput/textInputHelper', () => ({
    NOT_ALLOW_EDIT_TAGS: 'NOT_ALLOW_EDIT_TAGS',
    SUBTASK_THEME: 'SUBTASK_THEME',
    TASK_THEME: 'TASK_THEME',
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectIndexById: jest.fn(() => 0),
}))
jest.mock('../../../utils/Gmail/gmailTaskUtils', () => ({ isInboxSummaryGmailTask: jest.fn(() => false) }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

const createTaskInput = () => {
    const inputTask = React.createRef()
    let tree

    act(() => {
        tree = renderer.create(
            <TaskInput
                tmpTask={{ genericData: null, calendarData: null }}
                adding={true}
                projectId="project-1"
                accessGranted={true}
                loggedUserCanUpdateObject={true}
                isAssistant={false}
                inputTask={inputTask}
                onChangeInputText={jest.fn()}
                getInitialText={() => ''}
                onKeyEnterPressed={jest.fn()}
            />
        )
    })

    return { inputTask, tree }
}

describe('TaskInput focus', () => {
    const originalOS = Platform.OS

    beforeEach(() => {
        mockInputFocus.mockClear()
    })

    afterEach(() => {
        Platform.OS = originalOS
    })

    test('focuses a mobile inline task input as soon as it mounts', () => {
        Platform.OS = 'ios'
        const { tree } = createTaskInput()

        expect(mockInputFocus).toHaveBeenCalledTimes(1)
        expect(tree.root.findByType('CustomTextInput3').props.autoFocus).toBe(true)
    })

    test('keeps desktop inline task auto-focus behavior', () => {
        Platform.OS = 'web'
        const { tree } = createTaskInput()

        expect(mockInputFocus).toHaveBeenCalledTimes(1)
        expect(tree.root.findByType('CustomTextInput3').props.autoFocus).toBe(true)
    })
})
