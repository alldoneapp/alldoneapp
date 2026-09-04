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
// A faithful miniature of the real `translate`: resolve the KEY against the real translations,
// then interpolate. Interpolating the key itself would happen to work for the Gold rate (whose key
// and value are identical) while hiding every label whose value differs from its key — which is the
// whole shape of AT-2512.
jest.mock('../../../../i18n/TranslationService', () => {
    const en = require('../../../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
    }
})

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

        // 'GPT 5.6 Terra', not the key 'GPT 5_6 Terra': the underscore spelling is what is looked
        // up, the dotted one is what the user reads.
        expect(labels).toEqual(expect.arrayContaining(['GPT 5.6 Terra', '1 Gold = 200 tokens']))

        act(() => component.root.findByType(TouchableOpacity).props.onPress())
        expect(selectModel).toHaveBeenCalledWith('MODEL_GPT5_6_TERRA')
    })

    // AT-2512. `text` is a translation KEY, so an option whose label carries a runtime value hands
    // that value over as `textParams` and lets the key interpolate it. Building the sentence at the
    // call site instead reaches `translate()` as an unknown key and renders a `[missing …]`
    // placeholder — which is what the thread model picker shipped.
    test('interpolates textParams into the label instead of re-translating a finished string', () => {
        const component = renderer.create(
            <OptionItem
                modelData={{
                    text: 'Use assistant model with name',
                    textParams: { name: 'Luna' },
                    model: 'INHERIT_ASSISTANT_MODEL',
                    shortcutKey: '',
                }}
                selectedModel="INHERIT_ASSISTANT_MODEL"
                selectModel={jest.fn()}
            />
        )
        const labels = component.root.findAllByType(Text).map(node => node.props.children)

        expect(labels).toContain('Use assistant model (Luna)')
    })
})
