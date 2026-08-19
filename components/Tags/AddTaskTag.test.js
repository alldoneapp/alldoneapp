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
        default: ({ children }) => React.createElement('Popover', null, children),
    }
})
jest.mock('../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal', () => () => null)

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
})
