import React from 'react'
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

    it('labels the secondary action as a rejection for assistant suggestions', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} isAssistantSuggestion />)

        expect(findButton(tree, 'Reject')).toBeTruthy()
        expect(tree.root.findAllByProps({ title: 'Go to next step' })).toHaveLength(0)
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

    it('disables the bypass together with the next step action', () => {
        const tree = renderer.create(<SuggestedActions {...baseProps} showBypassWorkflow disabled />)

        expect(tree.root.findByProps({ testID: 'bypass-workflow-button' }).props.disabled).toBe(true)
        expect(findButton(tree, 'Go to next step').props.disabled).toBe(true)
    })
})
