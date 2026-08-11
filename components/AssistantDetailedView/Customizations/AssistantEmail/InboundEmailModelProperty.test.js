import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import InboundEmailModelProperty from './InboundEmailModelProperty'
import { updateAssistantEmailModel } from '../../../../utils/backends/Assistants/assistantsFirestore'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ smallScreen: false }),
}))

jest.mock('react-tiny-popover', () => ({ content, children }) => {
    const React = require('react')
    return React.createElement(React.Fragment, null, children, content)
})

jest.mock('../../../Icon', () => () => null)
jest.mock('../../../UIControls/Button', () => () => null)
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
}))
jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    updateAssistantEmailModel: jest.fn(),
}))

describe('InboundEmailModelProperty', () => {
    test('shows inherited model state and every selectable assistant model', () => {
        const component = renderer.create(
            <InboundEmailModelProperty
                disabled={false}
                projectId="project-1"
                assistant={{ uid: 'assistant-1', model: 'MODEL_GPT5_6_SOL' }}
            />
        )
        const labels = component.root.findAllByType(Text).map(node => node.props.children)

        expect(labels).toEqual(
            expect.arrayContaining(['Inherit assistant model (Sol)', 'Inherit assistant model', 'Sol', 'Terra', 'Luna'])
        )
    })

    test('stores an explicit override and clears it when inheritance is selected', () => {
        const assistant = {
            uid: 'assistant-1',
            model: 'MODEL_GPT5_6_SOL',
            emailModel: 'MODEL_GPT5_6_LUNA',
        }
        const component = renderer.create(
            <InboundEmailModelProperty disabled={false} projectId="project-1" assistant={assistant} />
        )
        const options = component.root.findAllByType(TouchableOpacity)
        const terraOption = options.find(node => node.findAllByType(Text)[0].props.children === 'Terra')
        const inheritOption = options.find(
            node => node.findAllByType(Text)[0].props.children === 'Inherit assistant model'
        )

        act(() => terraOption.props.onPress())
        act(() => inheritOption.props.onPress())

        expect(updateAssistantEmailModel).toHaveBeenNthCalledWith(1, 'project-1', assistant, 'MODEL_GPT5_6_TERRA')
        expect(updateAssistantEmailModel).toHaveBeenNthCalledWith(2, 'project-1', assistant, '')
    })
})
