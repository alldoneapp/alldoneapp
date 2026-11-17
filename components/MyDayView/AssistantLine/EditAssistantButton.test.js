import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EditAssistantButton, { EDIT_ASSISTANT_BUTTON_TEST_ID } from './EditAssistantButton'

jest.mock('../../Icon', () => 'Icon')
jest.mock('../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))

// AT-3069: the pencil at the top left of the assistant line.
describe('EditAssistantButton', () => {
    it('is a labelled pencil that opens the editor without letting the press reach the line', () => {
        const onPress = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(<EditAssistantButton onPress={onPress} />)
        })

        const button = tree.root.findByType(TouchableOpacity)
        expect(button.props.testID).toBe(EDIT_ASSISTANT_BUTTON_TEST_ID)
        expect(button.props.accessibilityLabel).toBe('Edit assistant')
        expect(button.findByType('Icon').props.name).toBe('edit-2')

        const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
        act(() => button.props.onPress(event))
        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(onPress).toHaveBeenCalledTimes(1)
    })
})
