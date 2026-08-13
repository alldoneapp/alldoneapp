import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import OptionItem from './OptionItem'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))
jest.mock('react-hot-keys', () => props => props.children)
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../UIControls/Shortcut', () => () => null)
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => key.replace('%{tokens}', values.tokens || ''),
}))

describe('AssistantModelModal OptionItem', () => {
    test('shows the assistant model Gold rate and keeps selection behavior', () => {
        const selectModel = jest.fn()
        const component = renderer.create(
            <OptionItem
                modelData={{
                    text: 'GPT 5_6 Terra',
                    model: 'MODEL_GPT5_6_TERRA',
                    tokensPerGold: 200,
                    shortcutKey: '',
                }}
                selectedModel="MODEL_GPT5_6_SOL"
                selectModel={selectModel}
            />
        )
        const labels = component.root.findAllByType(Text).map(node => node.props.children)

        expect(labels).toEqual(expect.arrayContaining(['GPT 5_6 Terra', '1 Gold = 200 tokens']))

        act(() => component.root.findByType(TouchableOpacity).props.onPress())
        expect(selectModel).toHaveBeenCalledWith('MODEL_GPT5_6_TERRA')
    })
})
