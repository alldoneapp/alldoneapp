import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import HeartbeatModelProperty from './HeartbeatModelProperty'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'

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
    translate: (key, values = {}) => key.replace('%{tokens}', values.tokens || ''),
}))
jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    updateAssistantHeartbeatSettings: jest.fn(),
}))

describe('HeartbeatModelProperty', () => {
    test('shows the billed Gold rate for every heartbeat model', () => {
        const component = renderer.create(
            <HeartbeatModelProperty
                disabled={false}
                projectId="project-1"
                assistant={{ uid: 'assistant-1', model: 'MODEL_GPT5_6_SOL' }}
            />
        )
        const labels = component.root.findAllByType(Text).map(node => node.props.children)

        expect(labels).toEqual(
            expect.arrayContaining([
                '1 Gold = 100 tokens',
                '1 Gold = 200 tokens',
                '1 Gold = 500 tokens',
                '1 Gold = 2,000 tokens',
            ])
        )
    })

    test('stores the selected heartbeat model', () => {
        const assistant = { uid: 'assistant-1', model: 'MODEL_GPT5_6_SOL' }
        const component = renderer.create(
            <HeartbeatModelProperty disabled={false} projectId="project-1" assistant={assistant} />
        )
        const terraOption = component.root
            .findAllByType(TouchableOpacity)
            .find(node => node.findAllByType(Text)[0].props.children === 'Terra')

        act(() => terraOption.props.onPress())

        expect(updateAssistantHeartbeatSettings).toHaveBeenCalledWith('project-1', assistant, {
            heartbeatModel: 'MODEL_GPT5_6_TERRA',
        })
    })
})
