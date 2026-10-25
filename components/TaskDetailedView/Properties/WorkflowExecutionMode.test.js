/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import WorkflowExecutionMode, { shouldShowExecutionModeSetting } from './WorkflowExecutionMode'
import { getUserWorkflow } from '../../ContactsView/Utils/ContactsHelper'
import { setTaskExecutionMode } from '../../../utils/backends/Tasks/tasksFirestore'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { uid: 'me' } }) }))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../UIControls/GhostButton', () => 'GhostButton')
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({ getUserWorkflow: jest.fn() }))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskExecutionMode: jest.fn() }))

const WORKFLOW = { 'step-1': { description: 'Review', reviewerUid: 'reviewer' } }
const task = overrides => ({ id: 'task-1', userId: 'owner', name: 'Ship it', ...overrides })

describe('shouldShowExecutionModeSetting', () => {
    it('shows the switch when the owner has a workflow to bypass', () => {
        expect(shouldShowExecutionModeSetting(task(), WORKFLOW)).toBe(true)
    })

    it('hides it when there is no workflow, since every completion goes straight to Done anyway', () => {
        expect(shouldShowExecutionModeSetting(task(), {})).toBe(false)
        expect(shouldShowExecutionModeSetting(task(), null)).toBe(false)
    })

    it('keeps it for a direct task without a workflow, so the choice can be put back', () => {
        expect(shouldShowExecutionModeSetting(task({ executionMode: 'direct' }), null)).toBe(true)
    })

    it('hides it for tasks that always complete directly', () => {
        expect(shouldShowExecutionModeSetting(task({ calendarData: { start: 1 } }), WORKFLOW)).toBe(false)
        expect(shouldShowExecutionModeSetting(task({ genericData: { type: 'day_rate' } }), WORKFLOW)).toBe(false)
        expect(shouldShowExecutionModeSetting(task({ gmailData: { origin: 'gmail_inbox_summary' } }), WORKFLOW)).toBe(
            false
        )
    })

    it('keeps it for a Gmail label follow-up, which completes like any other task', () => {
        expect(
            shouldShowExecutionModeSetting(
                task({ gmailData: { origin: 'gmail_label_follow_up', messageId: 'message-1' } }),
                WORKFLOW
            )
        ).toBe(true)
    })
})

describe('WorkflowExecutionMode', () => {
    beforeEach(() => {
        getUserWorkflow.mockReset().mockReturnValue(WORKFLOW)
        setTaskExecutionMode.mockReset()
    })

    const render = props => renderer.create(<WorkflowExecutionMode projectId="project-1" {...props} />)

    it('switches a workflow task to straight-to-Done', () => {
        const current = task({ executionMode: 'workflow' })
        const button = render({ task: current }).root.findByType('GhostButton')

        expect(button.props.title).toBe('Through workflow')
        act(() => button.props.onPress())
        expect(setTaskExecutionMode).toHaveBeenCalledWith('project-1', current, 'direct')
    })

    it('treats a task without a stored mode as going through the workflow', () => {
        const current = task()
        const button = render({ task: current }).root.findByType('GhostButton')

        expect(button.props.title).toBe('Through workflow')
        act(() => button.props.onPress())
        expect(setTaskExecutionMode).toHaveBeenCalledWith('project-1', current, 'direct')
    })

    it('switches a direct task back to the workflow', () => {
        const current = task({ executionMode: 'direct' })
        const button = render({ task: current }).root.findByType('GhostButton')

        expect(button.props.title).toBe('Straight to Done')
        act(() => button.props.onPress())
        expect(setTaskExecutionMode).toHaveBeenCalledWith('project-1', current, 'workflow')
    })

    it('reads the workflow of the owner, or of the logged user for a workstream task, like the checkbox', () => {
        render({ task: task() })
        expect(getUserWorkflow).toHaveBeenLastCalledWith('project-1', 'owner', expect.any(Object))

        render({ task: task({ userId: 'ws@default' }) })
        expect(getUserWorkflow).toHaveBeenLastCalledWith('project-1', 'me', expect.any(Object))
    })

    it('renders nothing when there is no workflow to bypass', () => {
        getUserWorkflow.mockReturnValue(null)
        expect(render({ task: task() }).toJSON()).toBeNull()
    })

    it('passes the Workflow row disabled state through', () => {
        const button = render({ task: task(), disabled: true }).root.findByType('GhostButton')
        expect(button.props.disabled).toBe(true)
    })
})

describe('mapTaskData', () => {
    // The checkbox decides between workflow and Done from the mapped task, and mapTaskData builds
    // its result field by field: a field it does not name is dropped. executionMode was dropped from
    // the day it was introduced, so "direct" never reached the checkbox or this switch. Asserted
    // against the source for the reason given in utils/taskRoutingActivity.test.js.
    it('carries executionMode through to the task the UI reads', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../../../utils/backends/firestore.js'),
            'utf8'
        )
        const mapTaskDataBody = source.slice(source.indexOf('export function mapTaskData'))
        const endOfMapper = mapTaskDataBody.indexOf('\nexport function ')

        expect(mapTaskDataBody.slice(0, endOfMapper)).toMatch(/executionMode: task\.executionMode/)
    })
})
