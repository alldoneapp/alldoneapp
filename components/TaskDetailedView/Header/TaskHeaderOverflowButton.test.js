import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import TaskHeaderOverflowButton from './TaskHeaderOverflowButton'

const mockLock = { acquire: jest.fn(), release: jest.fn() }

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../../hooks/useFloatPopupLock', () => () => mockLock)
jest.mock('../../UIComponents/ModalShell/AppPopover', () => 'AppPopover')
jest.mock('../../Icon', () => 'Icon')
jest.mock('./TaskHeaderOverflowModal', () => 'TaskHeaderOverflowModal')
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

const task = { id: 'task-1', isPublicFor: [0] }

const renderButton = () => {
    useSelector.mockImplementation(selector => selector({ smallScreenNavigation: false }))
    let tree
    act(() => {
        tree = renderer.create(<TaskHeaderOverflowButton projectId="project-1" task={task} showVisibility canSearch />)
    })
    return tree
}

// The menu is the popover's `content` element, not one of its children.
const menu = tree => tree.root.findByType('AppPopover').props.content

const trigger = tree =>
    tree.root.find(node => node.props.testID === 'task-header-overflow-button' && node.props.onPress)

describe('TaskHeaderOverflowButton (AT-3081)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('is a labelled button that reports whether its menu is open', () => {
        const tree = renderButton()

        expect(trigger(tree).props).toMatchObject({
            accessibilityRole: 'button',
            accessibilityLabel: 'More options',
            accessibilityState: { expanded: false },
        })
        expect(tree.root.findByType('AppPopover').props.isOpen).toBe(false)
        expect(menu(tree)).toBeNull()
    })

    it('opens the menu with the header context and holds the float-popup lock', () => {
        const tree = renderButton()

        act(() => trigger(tree).props.onPress())

        expect(tree.root.findByType('AppPopover').props.isOpen).toBe(true)
        expect(trigger(tree).props.accessibilityState).toEqual({ expanded: true })
        expect(menu(tree).type).toBe('TaskHeaderOverflowModal')
        expect(menu(tree).props).toMatchObject({
            projectId: 'project-1',
            task,
            showVisibility: true,
            canSearch: true,
        })
        expect(mockLock.acquire).toHaveBeenCalledTimes(1)
    })

    it('closes from the menu and from a second press, releasing the lock', () => {
        const tree = renderButton()

        act(() => trigger(tree).props.onPress())
        act(() => menu(tree).props.closeModal())
        expect(tree.root.findByType('AppPopover').props.isOpen).toBe(false)
        expect(mockLock.release).toHaveBeenCalledTimes(1)

        act(() => trigger(tree).props.onPress())
        act(() => trigger(tree).props.onPress())
        expect(tree.root.findByType('AppPopover').props.isOpen).toBe(false)
        expect(mockLock.release).toHaveBeenCalledTimes(2)
    })

    it('defers an outside click so the picker can finish its own click first', () => {
        jest.useFakeTimers()
        try {
            const tree = renderButton()
            act(() => trigger(tree).props.onPress())

            act(() => tree.root.findByType('AppPopover').props.onClickOutside())
            expect(tree.root.findByType('AppPopover').props.isOpen).toBe(true)

            act(() => jest.runAllTimers())
            expect(tree.root.findByType('AppPopover').props.isOpen).toBe(false)
        } finally {
            jest.useRealTimers()
        }
    })
})
