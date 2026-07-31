import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import HeartbeatReasoningEffortProperty from './HeartbeatReasoningEffortProperty'
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
    translate: key => key,
}))
jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    updateAssistantHeartbeatSettings: jest.fn(),
}))

describe('HeartbeatReasoningEffortProperty', () => {
    test('inherits assistant effort and offers every assistant effort option', () => {
        const component = renderer.create(
            <HeartbeatReasoningEffortProperty
                disabled={false}
                projectId="project-1"
                assistant={{ uid: 'assistant-1', reasoningEffort: 'high' }}
            />
        )
        const labels = component.root.findAllByType(Text).map(node => node.props.children)

        expect(labels).toEqual(
            expect.arrayContaining(['Model default', 'None', 'Low', 'Medium', 'High', 'XHigh', 'Max'])
        )
    })

    test('stores an explicit model default separately from inherited effort', () => {
        const assistant = { uid: 'assistant-1', reasoningEffort: 'high' }
        const component = renderer.create(
            <HeartbeatReasoningEffortProperty disabled={false} projectId="project-1" assistant={assistant} />
        )
        const modelDefaultOption = component.root
            .findAllByType(TouchableOpacity)
            .find(node => node.findByType(Text).props.children === 'Model default')

        act(() => modelDefaultOption.props.onPress())

        expect(updateAssistantHeartbeatSettings).toHaveBeenCalledWith('project-1', assistant, {
            heartbeatReasoningEffort: null,
        })
    })
})
