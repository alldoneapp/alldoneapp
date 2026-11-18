import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantWorkflowRunTag from './AssistantWorkflowRunTag'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { caption2: {} },
    colors: { Text03: '#8A94A6', UtilityBlue200: '#5AA0FF', UtilityRed200: '#FF8080' },
}))
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn(() => Promise.resolve()) }))

const failedTask = {
    id: 'task-1',
    workflowAiStatus: { runId: 'run-1', stepId: 'build', status: 'failed', failureReason: 'vm_interrupted' },
}

const labelOf = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .join('')

describe('AssistantWorkflowRunTag', () => {
    afterEach(() => jest.clearAllMocks())

    it('offers to retry a failed step and calls the retry callable', async () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantWorkflowRunTag projectId="project-1" task={failedTask} />)
        })
        expect(labelOf(tree)).toBe('Needs attention')

        await act(async () => {
            tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('retryWorkflowAiRunSecondGen', {
            projectId: 'project-1',
            taskId: 'task-1',
        })
    })

    it('shows nothing without a run status or once the task is done', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantWorkflowRunTag projectId="project-1" task={{ id: 'task-1' }} />)
        })
        expect(tree.toJSON()).toBeNull()
        act(() => {
            tree.update(<AssistantWorkflowRunTag projectId="project-1" task={{ ...failedTask, done: true }} />)
        })
        expect(tree.toJSON()).toBeNull()
    })

    // The tag reads the task the list hands it, and every task enters the app through mapTaskData,
    // which drops each field it does not name. workflowAiStatus was not named until 2026-11-18, so
    // the tag above never appeared on a single row (AT-3082 sat on a failed step with no retry).
    // Asserted against the source like `projectRouting` in utils/taskRoutingActivity.test.js:
    // importing utils/backends/firestore.js pulls in the redux store and the settings tree.
    it('is fed by mapTaskData, and a copied task does not inherit the run status', () => {
        const fs = require('fs')
        const path = require('path')
        const firestoreSource = fs.readFileSync(path.join(__dirname, '../../utils/backends/firestore.js'), 'utf8')
        const mapTaskDataBody = firestoreSource.slice(firestoreSource.indexOf('export function mapTaskData'))
        expect(mapTaskDataBody).toMatch(/workflowAiStatus: task\.workflowAiStatus/)

        const tasksSource = fs.readFileSync(
            path.join(__dirname, '../../utils/backends/Tasks/tasksFirestore.js'),
            'utf8'
        )
        const uploadNewTaskBody = tasksSource.slice(tasksSource.indexOf('export async function uploadNewTask'))
        expect(uploadNewTaskBody.slice(0, 600)).toMatch(/delete taskCopy\.workflowAiStatus/)
    })
})
