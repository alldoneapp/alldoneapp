/**
 * @jest-environment jsdom
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

// PT-5425: TaskEditForm decides whether a push-to-talk release on the title mic may close the
// add-task popup. It applies the same guards as Enter (an open mention picker / tag editor /
// assignee popup means the user is not done here) and links the objects the final title mentions.

let capturedInputProps
let mockState = { isQuillTagEditorOpen: false, openModals: {} }

jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/InputArea', () => props => {
    capturedInputProps = props
    return null
})
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/ButtonsArea', () => 'ButtonsArea')
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getTaskNameWithoutMeta: name => name },
}))
jest.mock('../../../utils/BackendBridge', () => ({ setLinkedParentObjects: jest.fn() }))
jest.mock('../../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))

import TaskEditForm from '../../../components/UIComponents/FloatModals/RichCreateTaskModal/TaskEditForm'
import { MENTION_MODAL_ID } from '../../../components/ModalsManager/modalsManager'

const Backend = require('../../../utils/BackendBridge')

const renderForm = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <TaskEditForm
                projectId="project-1"
                isAssigneeVisible={false}
                task={{ name: '', extendedName: '', description: '' }}
                setTask={jest.fn()}
                onSuccess={jest.fn()}
                mentions={[]}
                setMentions={jest.fn()}
                showDueDate={jest.fn()}
                showPrivacy={jest.fn()}
                showRecurring={jest.fn()}
                showParentGoal={jest.fn()}
                showMoreOptions={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

beforeEach(() => {
    capturedInputProps = null
    mockState = { isQuillTagEditorOpen: false, openModals: {} }
    Backend.setLinkedParentObjects.mockClear()
})

test('without a background creator the input keeps the interactive path', () => {
    const tree = renderForm()
    expect(capturedInputProps.claimDictationBackgroundSubmit).toBeUndefined()
    act(() => tree.unmount())
})

test('hands the claim over and links the objects of the final title to the created task', () => {
    const claimed = { dismiss: jest.fn(), submit: jest.fn(), onFailed: jest.fn() }
    const claimDictatedTaskInBackground = jest.fn(() => claimed)
    const tree = renderForm({ claimDictatedTaskInBackground })

    expect(capturedInputProps.claimDictationBackgroundSubmit()).toBe(claimed)

    const [onCreated] = claimDictatedTaskInBackground.mock.calls[0]
    onCreated({ id: 'task-9' }, { extendedText: 'Call Anna', linkedTasksUrls: ['https://t/1'] })
    expect(Backend.setLinkedParentObjects).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ linkedParentTasksUrl: ['https://t/1'], linkedParentNotesUrl: [] }),
        { type: 'task', id: 'task-9' }
    )
    act(() => tree.unmount())
})

test.each([
    [
        'the mention picker is open',
        () => (mockState = { isQuillTagEditorOpen: false, openModals: { [MENTION_MODAL_ID]: true } }),
    ],
    ['the tag editor is open', () => (mockState = { isQuillTagEditorOpen: true, openModals: {} })],
])('declines while %s', (_, arrange) => {
    arrange()
    const claimDictatedTaskInBackground = jest.fn(() => ({ submit: jest.fn() }))
    const tree = renderForm({ claimDictatedTaskInBackground })

    expect(capturedInputProps.claimDictationBackgroundSubmit()).toBeNull()
    expect(claimDictatedTaskInBackground).not.toHaveBeenCalled()
    act(() => tree.unmount())
})

test('declines while the assignee popup is visible', () => {
    const claimDictatedTaskInBackground = jest.fn(() => ({ submit: jest.fn() }))
    const tree = renderForm({ claimDictatedTaskInBackground, isAssigneeVisible: true })

    expect(capturedInputProps.claimDictationBackgroundSubmit()).toBeNull()
    expect(claimDictatedTaskInBackground).not.toHaveBeenCalled()
    act(() => tree.unmount())
})
