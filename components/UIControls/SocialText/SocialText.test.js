import React, { act as domAct } from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { createRoot } from 'react-dom/client'

import SocialText from './SocialText'
import { shouldOnPressInput } from '../../TaskListView/Utils/TasksHelper'

jest.mock('react-dom', () => ({
    ...jest.requireActual('react-dom'),
    findDOMNode: () => ({ offsetWidth: 100 }),
}))
jest.mock('../../Feeds/Utils/HelperFunctions', () => ({ parseFeedComment: () => [] }))
jest.mock('../../TaskListView/Utils/TasksHelper', () => ({ shouldOnPressInput: jest.fn(() => false) }))
jest.mock('../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    convertEstimationToPixels: () => 0,
}))
jest.mock('./Content', () => {
    const React = require('react')
    return () => React.createElement('span', { 'data-testid': 'social-content' }, 'Content')
})
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

    it('does not intercept a parent row press when it has no press action', () => {
        const text = renderSocialText({})

        expect(text.props.onPress).toBeUndefined()
    })

    it('lets a goal row enter edit mode when its title is clicked', () => {
        const onGoalPress = jest.fn()
        const container = document.createElement('div')
        const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT
        global.IS_REACT_ACT_ENVIRONMENT = true
        document.body.appendChild(container)
        const root = createRoot(container)

        domAct(() => {
            root.render(
                <TouchableOpacity onPress={onGoalPress}>
                    <SocialText projectId="project-1">Goal title</SocialText>
                </TouchableOpacity>
            )
        })

        domAct(() => {
            container
                .querySelector('[data-testid="social-content"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })

        expect(onGoalPress).toHaveBeenCalledTimes(1)

        domAct(() => root.unmount())
        container.remove()
        global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    })

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
