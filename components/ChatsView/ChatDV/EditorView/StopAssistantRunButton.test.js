import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

import StopAssistantRunButton, { canStopAssistantRun } from './StopAssistantRunButton'
import { resetStopRequests } from './stopAssistantRunRequests'
import { cancelAssistantRun } from '../../../../utils/backends/Assistants/assistantRuns'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('../../../Icon', () => 'Icon')
// TranslationService is deliberately NOT mocked: asserting the real English strings is
// what proves the new keys actually exist in i18n/translations/en.json.
jest.mock('../../../../utils/backends/Assistants/assistantRuns', () => ({
    cancelAssistantRun: jest.fn(() => Promise.resolve()),
}))

const runningRun = overrides => ({ kind: 'chat', status: 'running', runId: 'run-1', ...overrides })

const renderButton = (props = {}) =>
    renderer.create(
        <StopAssistantRunButton
            projectId="project-1"
            objectType="tasks"
            objectId="task-1"
            commentId="comment-1"
            assistantRun={runningRun()}
            isLoading={true}
            {...props}
        />
    )

const stopButton = tree => tree.root.findAllByType(TouchableOpacity)[0]
const buttonLabel = tree =>
    stopButton(tree)
        .findAllByType(Text)
        .map(node => node.props.children)
        .join('')

describe('StopAssistantRunButton', () => {
    beforeEach(() => {
        resetStopRequests()
        cancelAssistantRun.mockClear()
        cancelAssistantRun.mockImplementation(() => Promise.resolve())
    })

    describe('canStopAssistantRun', () => {
        const base = { assistantRun: runningRun(), objectId: 'task-1', loggedUserId: 'user-1', isLoading: true }

        test('accepts a live run owned by the viewer, for both chat and VM kinds', () => {
            expect(canStopAssistantRun(base)).toBe(true)
            expect(canStopAssistantRun({ ...base, assistantRun: runningRun({ kind: 'vm_job' }) })).toBe(true)
            expect(canStopAssistantRun({ ...base, assistantRun: runningRun({ requestUserId: 'user-1' }) })).toBe(true)
        })

        test('rejects everything that is not actually stoppable', () => {
            // Another user's run: only the requester may cancel it.
            expect(canStopAssistantRun({ ...base, assistantRun: runningRun({ requestUserId: 'user-2' }) })).toBe(false)
            // Already settled, already stopping, or waiting on the interaction card.
            expect(canStopAssistantRun({ ...base, assistantRun: runningRun({ status: 'completed' }) })).toBe(false)
            expect(canStopAssistantRun({ ...base, assistantRun: runningRun({ status: 'cancel_requested' }) })).toBe(
                false
            )
            expect(
                canStopAssistantRun({
                    ...base,
                    assistantRun: runningRun({ kind: 'vm_job', status: 'awaiting_user' }),
                })
            ).toBe(false)
            // Stale spinner expired by resolveEffectiveMessageLoading.
            expect(canStopAssistantRun({ ...base, isLoading: false })).toBe(false)
            // Nothing to address the cancel to.
            expect(canStopAssistantRun({ ...base, objectId: undefined })).toBe(false)
            expect(canStopAssistantRun({ ...base, assistantRun: runningRun({ runId: undefined }) })).toBe(false)
            expect(canStopAssistantRun({ ...base, assistantRun: undefined })).toBe(false)
        })
    })

    test('renders nothing when the run is not stoppable', () => {
        expect(renderButton({ assistantRun: runningRun({ status: 'completed' }) }).toJSON()).toBeNull()
        expect(renderButton({ isLoading: false }).toJSON()).toBeNull()
    })

    test('cancels the run through the shared callable with the caller context', async () => {
        const tree = renderButton({ objectType: 'goals', objectId: 'goal-9', commentId: 'comment-9' })

        expect(buttonLabel(tree)).toBe('Stop')

        await act(async () => {
            await stopButton(tree).props.onPress()
        })

        expect(cancelAssistantRun).toHaveBeenCalledTimes(1)
        expect(cancelAssistantRun).toHaveBeenCalledWith({
            projectId: 'project-1',
            objectType: 'goals',
            objectId: 'goal-9',
            commentId: 'comment-9',
            runKind: 'chat',
            runId: 'run-1',
        })
        expect(buttonLabel(tree)).toBe('Stopping…')
        expect(stopButton(tree).props.disabled).toBe(true)
    })

    test('sends one cancel only, however often the button is pressed', async () => {
        const tree = renderButton()

        await act(async () => {
            await Promise.all([stopButton(tree).props.onPress(), stopButton(tree).props.onPress()])
        })
        await act(async () => {
            await stopButton(tree).props.onPress()
        })

        expect(cancelAssistantRun).toHaveBeenCalledTimes(1)
    })

    test('a second surface showing the same run neither re-sends nor stays enabled', async () => {
        // The full chat view and the comment popup can both be mounted on the same run.
        const chatView = renderButton()
        const commentPopup = renderButton({ objectType: 'tasks', appearance: 'dark' })

        await act(async () => {
            await stopButton(chatView).props.onPress()
        })

        expect(buttonLabel(commentPopup)).toBe('Stopping…')
        expect(stopButton(commentPopup).props.disabled).toBe(true)

        await act(async () => {
            await stopButton(commentPopup).props.onPress()
        })

        expect(cancelAssistantRun).toHaveBeenCalledTimes(1)
    })

    test('a popup reopened on an already-stopping run mounts disabled', async () => {
        const firstMount = renderButton()
        await act(async () => {
            await stopButton(firstMount).props.onPress()
        })
        act(() => firstMount.unmount())

        const reopened = renderButton()

        expect(buttonLabel(reopened)).toBe('Stopping…')
        expect(stopButton(reopened).props.disabled).toBe(true)
    })

    test('a failed cancel is retryable and reports the reason', async () => {
        const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {})
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        cancelAssistantRun.mockRejectedValueOnce(new Error('network down'))
        const tree = renderButton()

        await act(async () => {
            await stopButton(tree).props.onPress()
        })

        expect(alertSpy).toHaveBeenCalledWith('Could not stop assistant: network down')
        expect(buttonLabel(tree)).toBe('Stop')
        expect(stopButton(tree).props.disabled).toBe(false)

        await act(async () => {
            await stopButton(tree).props.onPress()
        })

        expect(cancelAssistantRun).toHaveBeenCalledTimes(2)

        alertSpy.mockRestore()
        errorSpy.mockRestore()
    })

    test('disappears once the run settles and does not come back disabled', async () => {
        const tree = renderButton()
        await act(async () => {
            await stopButton(tree).props.onPress()
        })

        await act(async () => {
            tree.update(
                <StopAssistantRunButton
                    projectId="project-1"
                    objectType="tasks"
                    objectId="task-1"
                    commentId="comment-1"
                    assistantRun={runningRun({ status: 'cancelled' })}
                    isLoading={true}
                />
            )
        })
        expect(tree.toJSON()).toBeNull()

        // A brand-new run in the same thread is stoppable again.
        const nextRun = renderButton({ assistantRun: runningRun({ runId: 'run-2' }) })
        expect(buttonLabel(nextRun)).toBe('Stop')
        expect(stopButton(nextRun).props.disabled).toBe(false)
    })
})
