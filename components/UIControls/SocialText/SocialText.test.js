import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import SocialText from './SocialText'
import { shouldOnPressInput } from '../../TaskListView/Utils/TasksHelper'

jest.mock('react-dom', () => ({ findDOMNode: () => ({ offsetWidth: 100 }) }))
jest.mock('../../Feeds/Utils/HelperFunctions', () => ({ parseFeedComment: () => [] }))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({ shouldOnPressInput: jest.fn(() => false) }))
jest.mock('../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    convertEstimationToPixels: () => 0,
}))
jest.mock('./Content', () => 'Content')
jest.mock('./Dots', () => 'Dots')

const renderSocialText = props => {
    let tree
    act(() => {
        tree = renderer.create(<SocialText {...props}>Test</SocialText>)
    })
    return tree.root.findByType(Text)
}

describe('SocialText popup presses', () => {
    beforeEach(() => jest.clearAllMocks())

    it('keeps the normal popover press guard by default', () => {
        const onPress = jest.fn()
        const text = renderSocialText({ onPress })

        text.props.onPress({ target: {} })

        expect(shouldOnPressInput).toHaveBeenCalledTimes(1)
        expect(onPress).not.toHaveBeenCalled()
    })

    it('allows an embedded popup object title to handle its own press', () => {
        const onPress = jest.fn()
        const event = { target: {} }
        const text = renderSocialText({ onPress, allowPressInsidePopover: true })

        text.props.onPress(event)

        expect(shouldOnPressInput).not.toHaveBeenCalled()
        expect(onPress).toHaveBeenCalledWith(event)
    })

    it('still respects a blocked row when popup presses are allowed', () => {
        const onPress = jest.fn()
        const text = renderSocialText({ onPress, allowPressInsidePopover: true, blockOpen: true })

        text.props.onPress({ target: {} })

        expect(onPress).not.toHaveBeenCalled()
    })
})
