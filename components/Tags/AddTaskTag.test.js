/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import { colors } from '../styles/global'
import Icon from '../Icon'
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
        // Renders the popover content as well as the trigger so the tests can
        // assert on both the alignment props and the popup that opens.
        default: props => React.createElement('Popover', props, props.children, props.content),
    }
})
jest.mock('../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal', () => 'RichCreateTaskModal')

describe('AddTaskTag', () => {
    beforeEach(() => {
        useSelector.mockImplementation(selector =>
            selector({
                isQuillTagEditorOpen: false,
                openModals: {},
                smallScreenNavigation: false,
            })
        )
    })

    it('uses the assistant Search button colors when requested', () => {
        const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} />)
        const button = tree.root.findByType(TouchableOpacity)
        const icon = tree.root.findByType(Icon)
        const label = tree.root.find(node => node.type === Text && node.props.children === 'Add task')

        expect(StyleSheet.flatten(button.props.style)).toMatchObject({
            backgroundColor: colors.UtilityBlue200,
            borderColor: colors.UtilityBlue150,
        })
        expect(icon.props.color).toBe('#ffffff')
        expect(StyleSheet.flatten(label.props.style).color).toBe('#ffffff')
        expect(button.props.accessibilityRole).toBe('button')
        expect(button.props.accessibilityLabel).toBe('Add task')
    })

    it('keeps the existing neutral treatment by default', () => {
        const tree = renderer.create(<AddTaskTag projectId="project-1" />)
        const button = tree.root.findByType(TouchableOpacity)
        const icon = tree.root.findByType(Icon)
        const label = tree.root.find(node => node.type === Text && node.props.children === 'Add task')

        expect(StyleSheet.flatten(button.props.style)).toMatchObject({
            borderColor: colors.Text03,
        })
        expect(StyleSheet.flatten(button.props.style).backgroundColor).toBeUndefined()
        expect(icon.props.color).toBe(colors.Text03)
        expect(StyleSheet.flatten(label.props.style).color).toBe(colors.Text03)
    })

    // AT-2364: the big All Projects call to action is horizontally centered on
    // the screen, so its popup must be centered on it and open wide. Every
    // other add-task entry point keeps the anchored, legacy-width popup.
    it('opens a wide, center-aligned popup for the large call to action', () => {
        const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} large={true} />)
        const popover = tree.root.findByType('Popover')

        expect(popover.props.align).toBe('center')
        expect(tree.root.findByType('RichCreateTaskModal').props.wide).toBe(true)
    })

    it('keeps the anchored, default-width popup for the regular tag', () => {
        const tree = renderer.create(<AddTaskTag projectId="project-1" />)
        const popover = tree.root.findByType('Popover')

        expect(popover.props.align).toBe('start')
        expect(tree.root.findByType('RichCreateTaskModal').props.wide).toBeFalsy()
    })
})
