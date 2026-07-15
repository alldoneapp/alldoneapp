/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailTaskAction from './EmailTaskAction'
import { performEmailLineAction } from '../../../utils/backends/EmailLine/emailLineBackend'
import URLTrigger from '../../../URLSystem/URLTrigger'

jest.mock('../../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: jest.fn() } }))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../utils/LinkingHelper', () => ({
    getDvMainTabLink: jest.fn((projectId, objectId) => `/projects/${projectId}/tasks/${objectId}/properties`),
}))

const findByLabel = (tree, label) =>
    tree.root.findAll(node => node.type === TouchableOpacity && node.props.accessibilityLabel === label)

describe('EmailTaskAction', () => {
    beforeEach(() => jest.clearAllMocks())

    it('checks for and opens an existing task instead of prompting for a duplicate', async () => {
        performEmailLineAction.mockResolvedValue({
            taskCreated: { taskId: 'task-1', projectId: 'project-1', taskName: 'Existing task' },
        })
        let tree
        await act(async () => {
            tree = renderer.create(
                <EmailTaskAction connectionId="connection-1" messageIds={['message-1']} checkExisting />
            )
            await Promise.resolve()
        })

        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'getTaskForEmail',
            messageIds: ['message-1'],
        })
        expect(findByLabel(tree, 'Create task')).toHaveLength(0)

        const [existingTask] = findByLabel(tree, 'Task created')
        act(() => existingTask.props.onPress())
        expect(URLTrigger.processUrl).toHaveBeenCalledWith(
            expect.anything(),
            '/projects/project-1/tasks/task-1/properties'
        )
    })

    it('uses the shared create flow and immediately switches to the created state', async () => {
        performEmailLineAction
            .mockResolvedValueOnce({ taskCreated: null })
            .mockResolvedValueOnce({ taskId: 'task-2', projectId: 'project-2' })
        let tree
        await act(async () => {
            tree = renderer.create(
                <EmailTaskAction connectionId="connection-1" messageIds={['message-1']} checkExisting />
            )
            await Promise.resolve()
        })

        const [createTask] = findByLabel(tree, 'Create task')
        await act(async () => {
            createTask.props.onPress()
            await Promise.resolve()
        })

        expect(performEmailLineAction).toHaveBeenLastCalledWith('connection-1', {
            action: 'createTask',
            messageIds: ['message-1'],
            labelId: null,
            labelName: null,
        })
        expect(findByLabel(tree, 'Task created')).toHaveLength(1)
        expect(findByLabel(tree, 'Create task')).toHaveLength(0)
    })
})
