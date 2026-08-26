/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import { colors, PROJECT_LINE_TAG_HEIGHT, PROJECT_LINE_TAG_MOBILE_WIDTH } from '../styles/global'
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

const findLabel = tree => tree.root.findAll(node => node.type === Text && node.props.children === 'Add task')

describe('AddTaskTag', () => {
    beforeEach(() => {
        mockState()
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

        // Asserted as a literal too, not only via the token: a token compared
        // against itself would still pass if it were renamed out of existence
        // and both sides became undefined.
        expect(colors.Primary100).toBe('#007FFF')
        expect(StyleSheet.flatten(button.props.style)).toMatchObject({
            backgroundColor: '#007FFF',
            borderColor: '#007FFF',
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
        expect(colors.UtilityBlue200).toBe('#5AACFF')
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

    it('opens automatically and prefills the existing popup for a shared link', () => {
        const openPopover = jest.fn()
        const onAutoOpen = jest.fn()
        let tree

        act(() => {
            tree = renderer.create(
                <AddTaskTag
                    projectId="project-1"
                    initialTaskName="https://example.com/shared"
                    autoOpenKey="share-1"
                    onAutoOpen={onAutoOpen}
                    openPopover={openPopover}
                />
            )
        })

        expect(openPopover).toHaveBeenCalledTimes(1)
        expect(onAutoOpen).toHaveBeenCalledTimes(1)
        expect(tree.root.findByType('RichCreateTaskModal').props.initialTaskName).toBe('https://example.com/shared')

        act(() => {
            tree.update(
                <AddTaskTag
                    projectId="project-1"
                    autoOpenKey="share-1"
                    onAutoOpen={onAutoOpen}
                    openPopover={openPopover}
                />
            )
        })

        expect(openPopover).toHaveBeenCalledTimes(1)
        expect(onAutoOpen).toHaveBeenCalledTimes(1)
        expect(tree.root.findByType('RichCreateTaskModal').props.initialTaskName).toBe('https://example.com/shared')
    })

    // The icon-only pill on the project lines IS its own tap target - there is no
    // label and no padding to press - and a 24x24 box around a 16px icon was too
    // small to hit reliably with a thumb. It is widened, never made taller: the
    // header row is hard-capped at 24 (`TagsArea.container`,
    // `AllProjectsLine.leftContainer`), so height is not an axis we own here.
    describe('icon-only tap target on mobile', () => {
        it('widens the pill past the icon box while keeping the row height', () => {
            mockState({ smallScreenNavigation: true })

            const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            expect(style.width).toBe(PROJECT_LINE_TAG_MOBILE_WIDTH)
            expect(style.height).toBe(PROJECT_LINE_TAG_HEIGHT)
            // Asserted as literals too, so renaming the tokens out of existence
            // cannot leave both sides `undefined` and still pass.
            expect(style.width).toBe(40)
            expect(style.height).toBe(24)
            // Strictly wider than the icon's own box - the point of the change.
            expect(style.width).toBeGreaterThan(style.height)
        })

        it('stays icon-only and keeps its accessible name', () => {
            mockState({ smallScreenNavigation: true })

            const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} />)
            const button = tree.root.findByType(TouchableOpacity)

            // Widened, NOT labelled: the row has no width budget for the text.
            expect(findLabel(tree)).toHaveLength(0)
            expect(tree.root.findByType(Icon).props.size).toBe(16)
            expect(button.props.accessibilityLabel).toBe('Add task')
            expect(button.props.accessibilityRole).toBe('button')
        })

        it('preserves the pill shape and colors it had at 24px', () => {
            mockState({ smallScreenNavigation: true })

            const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            expect(style.borderRadius).toBe(50)
            expect(style.borderWidth).toBe(1)
            expect(style.justifyContent).toBe('center')
            expect(style.alignItems).toBe('center')
            expect(style.backgroundColor).toBe(colors.UtilityBlue200)
            expect(style.borderColor).toBe(colors.UtilityBlue150)
        })

        it('leaves the labelled desktop pill auto-width', () => {
            mockState({ smallScreenNavigation: false })

            const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            // No fixed width on desktop: the pill hugs its label as before.
            expect(style.width).toBeUndefined()
            expect(style.height).toBe(24)
            expect(style.paddingHorizontal).toBe(4)
            expect(findLabel(tree)).toHaveLength(1)
        })

        it('applies the same widened box to forceShrink on a wide screen', () => {
            mockState({ smallScreenNavigation: false })

            const tree = renderer.create(<AddTaskTag projectId="project-1" forceShrink={true} />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            expect(findLabel(tree)).toHaveLength(0)
            expect(style.width).toBe(PROJECT_LINE_TAG_MOBILE_WIDTH)
        })

        // The empty-inbox call to action is a different control that happens to
        // share this component; the narrow-screen widening must not reach it.
        it('never applies the mobile box to the large call to action', () => {
            mockState({ smallScreenNavigation: true })

            const tree = renderer.create(<AddTaskTag projectId="project-1" primary={true} large={true} />)
            const style = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

            expect(style.width).toBeUndefined()
            expect(style.height).toBe(44)
            expect(style.paddingHorizontal).toBe(20)
            expect(findLabel(tree)).toHaveLength(1)
        })

        // Callers keep the last word on style (unchanged precedence), which is
        // how a future row could opt out of the wider target locally.
        it('still lets a caller style override the widened box', () => {
            mockState({ smallScreenNavigation: true })

            const tree = renderer.create(<AddTaskTag projectId="project-1" style={{ width: 24 }} />)

            expect(StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).width).toBe(24)
        })
    })
})
