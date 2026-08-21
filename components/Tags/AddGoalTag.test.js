/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import { colors, PROJECT_LINE_TAG_HEIGHT, PROJECT_LINE_TAG_MOBILE_WIDTH } from '../styles/global'
import Icon from '../Icon'
import AddGoalTag from './AddGoalTag'
import AddTaskTag from './AddTaskTag'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: jest.fn(),
    showFloatPopup: jest.fn(),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../styles/global', () => {
    const actual = jest.requireActual('../styles/global')
    return { __esModule: true, ...actual, windowTagStyle: () => ({}) }
})
jest.mock('../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention-modal' }))
jest.mock('../UIComponents/HOC/withSafePopover', () => Component => props => (
    <Component openPopover={jest.fn()} closePopover={jest.fn()} isOpen={false} {...props} />
))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return {
        __esModule: true,
        default: props => React.createElement('Popover', props, props.children, props.content),
    }
})
jest.mock('../UIComponents/FloatModals/RichCreateGoalModal/RichCreateGoalModal', () => 'RichCreateGoalModal')
jest.mock('../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal', () => 'RichCreateTaskModal')

const mockState = (overrides = {}) => {
    useSelector.mockImplementation(selector =>
        selector({
            isQuillTagEditorOpen: false,
            openModals: {},
            smallScreenNavigation: false,
            ...overrides,
        })
    )
}

const buttonStyleOf = element =>
    StyleSheet.flatten(renderer.create(element).root.findByType(TouchableOpacity).props.style)

describe('AddGoalTag', () => {
    beforeEach(() => {
        mockState()
    })

    describe('icon-only tap target on mobile', () => {
        it('widens the pill past the icon box while keeping the row height', () => {
            mockState({ smallScreenNavigation: true })

            const style = buttonStyleOf(<AddGoalTag projectId="project-1" />)

            expect(style.width).toBe(PROJECT_LINE_TAG_MOBILE_WIDTH)
            expect(style.height).toBe(PROJECT_LINE_TAG_HEIGHT)
            expect(style.width).toBe(40)
            expect(style.height).toBe(24)
        })

        it('stays icon-only and preserves the pill shape', () => {
            mockState({ smallScreenNavigation: true })

            const tree = renderer.create(<AddGoalTag projectId="project-1" />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            expect(tree.root.findAll(node => node.type === Text && node.props.children === 'Add goal')).toHaveLength(0)
            expect(tree.root.findByType(Icon).props.size).toBe(16)
            expect(style.borderRadius).toBe(50)
            expect(style.borderWidth).toBe(1)
            expect(style.borderColor).toBe(colors.Text03)
        })

        it('leaves the labelled desktop pill auto-width', () => {
            mockState({ smallScreenNavigation: false })

            const tree = renderer.create(<AddGoalTag projectId="project-1" />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            expect(style.width).toBeUndefined()
            expect(style.height).toBe(24)
            expect(tree.root.findAll(node => node.type === Text && node.props.children === 'Add goal')).toHaveLength(1)
        })
    })

    // The two pills sit side by side on the same project header rows (`TagsArea`),
    // so a mismatched tap target is immediately visible as one being smaller than
    // its neighbour. They share the token precisely so this cannot drift; this
    // test is the ratchet that keeps a future edit to one of them honest.
    it('matches the AddTaskTag pill it sits beside', () => {
        mockState({ smallScreenNavigation: true })

        const goal = buttonStyleOf(<AddGoalTag projectId="project-1" />)
        const task = buttonStyleOf(<AddTaskTag projectId="project-1" />)

        expect(goal.width).toBe(task.width)
        expect(goal.height).toBe(task.height)
        expect(goal.borderRadius).toBe(task.borderRadius)
    })
})
