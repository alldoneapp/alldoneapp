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

    // AT-2389: the big All Projects / My Day call to action is the primary
    // action of the screen it lives on, so it takes the app's primary blue
    // rather than the lighter Search-button tint of the small header pills.
    it('uses the primary blue for the large call to action', () => {
        const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} large={true} />)
        const button = tree.root.findByType(TouchableOpacity)
        const icon = tree.root.findByType(Icon)
        const label = tree.root.find(node => node.type === Text && node.props.children === 'Add task')

        expect(StyleSheet.flatten(button.props.style)).toMatchObject({
            backgroundColor: colors.Primary100,
            borderColor: colors.Primary100,
        })
        // White on the primary blue, same as before the recolor.
        expect(icon.props.color).toBe('#ffffff')
        expect(StyleSheet.flatten(label.props.style).color).toBe('#ffffff')
        // The recolor must not disturb the large variant's geometry.
        expect(StyleSheet.flatten(button.props.style)).toMatchObject({
            height: 44,
            paddingHorizontal: 20,
            borderWidth: 1,
            borderRadius: 50,
        })
        expect(button.props.accessibilityRole).toBe('button')
        expect(button.props.accessibilityLabel).toBe('Add task')
    })

    // The small header pills deliberately match the assistant Search button, so
    // the AT-2389 recolor is scoped to `large` and must not reach them.
    it('leaves the small primary pill on the Search button tint', () => {
        const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} />)
        const button = tree.root.findByType(TouchableOpacity)

        expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe(colors.UtilityBlue200)
        expect(StyleSheet.flatten(button.props.style).backgroundColor).not.toBe(colors.Primary100)
    })

    // A caller-supplied style still overrides the variant (unchanged precedence).
    it('lets a caller style override the large primary colors', () => {
        const tree = renderer.create(
            <AddTaskTag
                projectId="project-1"
                primary={true}
                large={true}
                style={{ backgroundColor: 'rebeccapurple' }}
            />
        )
        const button = tree.root.findByType(TouchableOpacity)

        expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe('rebeccapurple')
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
