import React from 'react'
import renderer from 'react-test-renderer'

import WorkflowBarButtons, { getWorkflowBarActionLabels } from './WorkflowBarButtons'

jest.mock('../UIControls/Button', () => 'Button')
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ OPEN_STEP: -1 }))
jest.mock('./workflowDirections', () => ({ WORKFLOW_BACKWARD: 'BACKWARD', WORKFLOW_FORWARD: 'FORWARD' }))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, interpolations = {}) =>
        Object.entries(interpolations).reduce(
            (translated, [key, value]) => translated.replace(`%{${key}}`, value),
            text === 'Workflow action with target step' ? '%{action}: %{step}' : text
        ),
}))

const renderButtons = props =>
    renderer.create(
        <WorkflowBarButtons
            currentStep={0}
            onDonePress={jest.fn()}
            disabled={false}
            backwardStepName="AI: please build"
            forwardStepName="Check what AI did"
            {...props}
        />
    )

const byTestId = (tree, testID) => tree.root.findAll(node => node.props.testID === testID && node.type === 'Button')

describe('WorkflowBarButtons (AT-3081)', () => {
    it('names both destinations on desktop and in the accessible name', () => {
        const tree = renderButtons()
        const [back] = byTestId(tree, 'workflow-bar-backward')
        const [forward] = byTestId(tree, 'workflow-bar-forward')

        expect(back.props).toMatchObject({
            type: 'secondary',
            title: 'Send back: AI: please build',
            accessible: true,
            accessibilityRole: 'button',
            accessibilityLabel: 'Send back: AI: please build',
        })
        expect(forward.props).toMatchObject({
            type: 'primary',
            title: 'Send forward: Check what AI did',
            accessibilityLabel: 'Send forward: Check what AI did',
        })
    })

    it('keeps the main next action readable on a phone and shrinks Back to an arrow', () => {
        const tree = renderButtons({ narrow: true })
        const [back] = byTestId(tree, 'workflow-bar-backward')
        const [forward] = byTestId(tree, 'workflow-bar-forward')

        expect(back.props.title).toBeNull()
        expect(back.props.icon).toBe('arrow-left')
        expect(back.props.accessibilityLabel).toBe('Send back: AI: please build')
        expect(forward.props.title).toBe('Send forward')
        expect(forward.props.accessibilityLabel).toBe('Send forward: Check what AI did')
    })

    it('stays one 32px row', () => {
        const tree = renderButtons()
        const flatten = style =>
            []
                .concat(style)
                .flat(Infinity)
                .filter(Boolean)
                .reduce((a, b) => ({ ...a, ...b }), {})

        for (const button of tree.root.findAllByType('Button')) {
            expect(flatten(button.props.buttonStyle)).toMatchObject({ height: 32, maxHeight: 32, minHeight: 32 })
        }
    })

    it('sends the pressed direction to the caller', () => {
        const onDonePress = jest.fn()
        const tree = renderButtons({ onDonePress })

        byTestId(tree, 'workflow-bar-forward')[0].props.onPress()
        byTestId(tree, 'workflow-bar-backward')[0].props.onPress()

        expect(onDonePress.mock.calls).toEqual([['FORWARD'], ['BACKWARD']])
    })

    it('hides Back on Open and words Forward as entering the workflow', () => {
        const tree = renderButtons({ currentStep: -1, backwardStepName: undefined })

        expect(byTestId(tree, 'workflow-bar-backward')).toHaveLength(0)
        expect(byTestId(tree, 'workflow-bar-forward')[0].props.title).toBe('Go to next step: Check what AI did')
    })

    it('hides Forward on Done', () => {
        const tree = renderButtons({ currentStep: -2, hideForwardButton: true, forwardStepName: undefined })

        expect(byTestId(tree, 'workflow-bar-forward')).toHaveLength(0)
        expect(byTestId(tree, 'workflow-bar-backward')).toHaveLength(1)
    })

    it('disables both buttons together', () => {
        const tree = renderButtons({ disabled: true })

        for (const button of tree.root.findAllByType('Button')) {
            expect(button.props.disabled).toBe(true)
            expect(button.props.accessibilityState).toEqual({ disabled: true })
        }
    })

    it('falls back to the bare action when a destination has no name', () => {
        expect(getWorkflowBarActionLabels({ currentStep: 0 })).toEqual({
            forwardAction: 'Send forward',
            backwardAction: 'Send back',
            forwardLabel: 'Send forward',
            backwardLabel: 'Send back',
        })
    })
})
