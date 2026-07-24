import React from 'react'
import renderer from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

jest.mock('../../../../../i18n/TranslationService', () => ({ translate: text => text }))

import CheckBoxContainer from './CheckBoxContainer'
import ActionPopupIndicator from './ActionPopupIndicator'
import AiStepCheckBox from './AiStepCheckBox'
import CheckBox from '../../../../CheckBox'

const getProps = overrides => ({
    isSubtask: false,
    isObservedTask: false,
    isToReviewTask: false,
    isSuggested: false,
    isActiveOrganizeMode: false,
    checkOnDrag: false,
    highlightColor: '#fff',
    accessGranted: true,
    pending: false,
    showWorkflowIndicator: false,
    showEmailCompletionIndicator: false,
    isNextStepAi: false,
    aiStepRunning: false,
    onCheckboxPress: jest.fn(),
    checkBoxIdRef: { current: 'checkbox-1' },
    checked: false,
    loggedUserCanUpdateObject: true,
    ...overrides,
})

describe('CheckBoxContainer action popup indicator', () => {
    test('shows the workflow-style dot and opens an interaction for an email-linked task', () => {
        const props = getProps({ showEmailCompletionIndicator: true })
        const tree = renderer.create(<CheckBoxContainer {...props} />)

        expect(tree.root.findByType(ActionPopupIndicator).props.visible).toBe(true)
        tree.root.findByType(TouchableOpacity).props.onPress()
        expect(props.onCheckboxPress).toHaveBeenCalledWith(true)
    })

    test('preserves direct checkbox behavior for a regular task', () => {
        const props = getProps()
        const tree = renderer.create(<CheckBoxContainer {...props} />)

        expect(tree.root.findByType(ActionPopupIndicator).props.visible).toBe(false)
        tree.root.findByType(TouchableOpacity).props.onPress()
        expect(props.onCheckboxPress).toHaveBeenCalledWith(false)
        expect(tree.root.findAllByType(CheckBox)).toHaveLength(1)
        expect(tree.root.findAllByType(AiStepCheckBox)).toHaveLength(0)
    })

    test('replaces the unchecked control for an AI next step without changing its interaction', () => {
        const props = getProps({ isNextStepAi: true })
        const tree = renderer.create(<CheckBoxContainer {...props} />)
        const button = tree.root.findByType(TouchableOpacity)

        expect(tree.root.findAllByType(CheckBox)).toHaveLength(0)
        expect(tree.root.findByType(AiStepCheckBox).props.running).toBe(false)
        expect(button.props.title).toBe('Run AI step')
        expect(button.props.accessibilityLabel).toBe('Run AI step')

        button.props.onPress()
        expect(props.onCheckboxPress).toHaveBeenCalledWith(false)
    })

    test('shows the AI control running state while its transition is pending', () => {
        const tree = renderer.create(
            <CheckBoxContainer {...getProps({ isNextStepAi: true, aiStepRunning: true, checked: true })} />
        )

        expect(tree.root.findByType(AiStepCheckBox).props.running).toBe(true)
    })

    test('uses the normal completed treatment after an AI action completes', () => {
        const tree = renderer.create(<CheckBoxContainer {...getProps({ isNextStepAi: true, checked: true })} />)

        expect(tree.root.findAllByType(AiStepCheckBox)).toHaveLength(0)
        expect(tree.root.findByType(CheckBox).props.checked).toBe(true)
    })
})
