import React from 'react'
import { StyleSheet } from 'react-native'
import renderer from 'react-test-renderer'

import SuggestedActions from './SuggestedActions'

jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../UIControls/Button', () => 'Button')

const findButton = (tree, title) => tree.root.findByProps({ title })

describe('SuggestedActions', () => {
    const baseProps = {
        onNextStepPress: jest.fn(),
        onAcceptPress: jest.fn(),
        onBypassWorkflowPress: jest.fn(),
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('keeps the existing next step and accept actions', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} />)

        expect(findButton(tree, 'Go to next step').props.type).toBe('secondary')
        expect(findButton(tree, 'Accept').props.type).toBe('primary')
    })

    // AT-2354: the bypass link must clear the button row by the full 16px bottom padding,
    // and the row may grow rather than clamp a taller button into it.
    it('states the button row padding on both sides so the bypass link keeps its distance', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} showBypassWorkflow />)
        const container = tree.root.findByProps({ testID: 'suggested-actions-buttons' })
        const style = StyleSheet.flatten(container.props.style)

        expect(style).toMatchObject({ minHeight: 72, paddingTop: 16, paddingBottom: 16 })
        expect(style.height).toBeUndefined()
    })

    it('labels the secondary action as a rejection for assistant suggestions', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} isAssistantSuggestion />)

        expect(findButton(tree, 'Reject')).toBeTruthy()
        expect(tree.root.findAllByProps({ title: 'Go to next step' })).toHaveLength(0)
    })

    // AT-2210: same rule as the section-level "Reject all" button — the icon follows the label.
    it('pairs the rejection with a reject icon and the next step with the workflow icon', () => {
        const rejection = renderer.create(<SuggestedActions {...baseProps} isAssistantSuggestion />)
        expect(findButton(rejection, 'Reject').props.icon).toBe('x')

        const nextStep = renderer.create(<SuggestedActions {...baseProps} />)
        expect(findButton(nextStep, 'Go to next step').props.icon).toBe('next-workflow')
    })

    it('does not offer the bypass when there is no workflow to skip', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} />)

        expect(tree.root.findAllByProps({ testID: 'bypass-workflow-button' })).toHaveLength(0)
    })

    it('offers the bypass to Done when a workflow would otherwise be entered', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} showBypassWorkflow />)
        const bypass = tree.root.findByProps({ testID: 'bypass-workflow-button' })

        bypass.props.onPress()

        expect(baseProps.onBypassWorkflowPress).toHaveBeenCalledTimes(1)
        expect(baseProps.onNextStepPress).not.toHaveBeenCalled()
        expect(baseProps.onAcceptPress).not.toHaveBeenCalled()
    })

    it('labels the bypass as a workflow bypass that marks the task done by default', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} showBypassWorkflow />)

        expect(tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.accessibilityLabel).toBe(
            'Bypass workflow and mark done'
        )
    })

    // AT-2164: on an assistant/email suggestion in a project without a workflow there is nothing
    // to "bypass" — the link accepts the task and completes it.
    it('uses the given label when there is no workflow to bypass', () => {
        const tree = renderer.create(
            <SuggestedActions
                {...baseProps}
                isAssistantSuggestion
                showBypassWorkflow
                bypassWorkflowLabel="Accept and mark done"
            />
        )
        const bypass = tree.root.findByProps({ testID: 'bypass-workflow-button' })

        expect(bypass.props.accessibilityLabel).toBe('Accept and mark done')

        bypass.props.onPress()
        expect(baseProps.onBypassWorkflowPress).toHaveBeenCalledTimes(1)
        expect(baseProps.onNextStepPress).not.toHaveBeenCalled()
    })

    it('disables the bypass together with the next step action', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} showBypassWorkflow disabled />)

        expect(tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.disabled).toBe(true)
        expect(findButton(tree, 'Go to next step').props.disabled).toBe(true)
    })
})
