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

    it('renders Create task immediately while the existing-task lookup is pending', async () => {
        let resolveLookup
        performEmailLineAction.mockReturnValue(
            new Promise(resolve => {
                resolveLookup = resolve
            })
        )
        let tree
        act(() => {
            tree = renderer.create(
                <EmailTaskAction connectionId="connection-1" messageIds={['message-1']} checkExisting />
            )
        })

        const [createTask] = findByLabel(tree, 'Create task')
        expect(createTask.props.disabled).toBe(false)
        expect(findByLabel(tree, 'Loading')).toHaveLength(0)
        expect(performEmailLineAction).toHaveBeenCalledWith('connection-1', {
            action: 'getTaskForEmail',
            messageIds: ['message-1'],
        })

        await act(async () => {
            resolveLookup({ taskCreated: null })
            await Promise.resolve()
        })
        expect(findByLabel(tree, 'Create task')).toHaveLength(1)
    })

    it('asynchronously upgrades Create task to a link when an existing task is found', async () => {
        let resolveLookup
        performEmailLineAction.mockReturnValue(
            new Promise(resolve => {
                resolveLookup = resolve
            })
        )
        let tree
        act(() => {
            tree = renderer.create(
                <EmailTaskAction connectionId="connection-1" messageIds={['message-1']} checkExisting />
            )
        })
        expect(findByLabel(tree, 'Create task')).toHaveLength(1)

        await act(async () => {
            resolveLookup({
                taskCreated: { taskId: 'task-1', projectId: 'project-1', taskName: 'Existing task' },
            })
            await Promise.resolve()
        })

        expect(findByLabel(tree, 'Create task')).toHaveLength(0)

        const [existingTask] = findByLabel(tree, 'Task created')
        act(() => existingTask.props.onPress())
        expect(URLTrigger.processUrl).toHaveBeenCalledWith(
            expect.anything(),
            '/projects/project-1/tasks/task-1/properties'
        )
    })

    it('immediately uses a locally known linked task without starting a lookup', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <EmailTaskAction
                    connectionId="connection-1"
                    messageIds={['message-1']}
                    initialTask={{ taskId: 'task-local', projectId: 'project-local' }}
                    checkExisting
                />
            )
        })

        expect(findByLabel(tree, 'Task created')).toHaveLength(1)
        expect(findByLabel(tree, 'Create task')).toHaveLength(0)
        expect(performEmailLineAction).not.toHaveBeenCalled()
    })

    it('uses the shared create flow while lookup continues and keeps the created state', async () => {
        let resolveLookup
        performEmailLineAction.mockImplementation((connectionId, params) => {
            if (params.action === 'getTaskForEmail') {
                return new Promise(resolve => {
                    resolveLookup = resolve
                })
            }
            return Promise.resolve({ taskId: 'task-2', projectId: 'project-2' })
        })
        let tree
        act(() => {
            tree = renderer.create(
                <EmailTaskAction connectionId="connection-1" messageIds={['message-1']} checkExisting />
            )
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

        await act(async () => {
            resolveLookup({ taskCreated: null })
            await Promise.resolve()
        })
        expect(findByLabel(tree, 'Task created')).toHaveLength(1)
    })
})
