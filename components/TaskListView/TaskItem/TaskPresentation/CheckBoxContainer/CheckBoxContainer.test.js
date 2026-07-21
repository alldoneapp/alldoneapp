import React from 'react'
import renderer from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import CheckBoxContainer from './CheckBoxContainer'
import ActionPopupIndicator from './ActionPopupIndicator'

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
    })
})
