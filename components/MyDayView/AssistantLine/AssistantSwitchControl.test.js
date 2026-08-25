import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantSwitchControl, { ASSISTANT_SWITCH_BUTTON_TEST_ID } from './AssistantSwitchControl'

const mockDispatch = jest.fn()
let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../UIComponents/ModalShell/AppPopover', () => 'AppPopover')
jest.mock('../../UIComponents/FloatModals/ChangeAssistantModal/AssistantSwitchModal', () => 'AssistantSwitchModal')
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'Show float popup' }),
    hideFloatPopup: () => ({ type: 'Hide float popup' }),
}))

const option = (projectId, assistantId) => ({
    key: `${projectId}:${assistantId}`,
    assistantId,
    projectId,
    projectName: projectId,
    isDefaultProjectAssistant: false,
    assistant: { uid: assistantId, displayName: assistantId },
})

const groupOf = (projectId, ...assistantIds) => ({
    projectId,
    projectName: projectId,
    options: assistantIds.map(assistantId => option(projectId, assistantId)),
})

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<AssistantSwitchControl {...props} />)
    })
    return tree
}

const findButton = tree =>
    tree.root.findAllByType(TouchableOpacity).find(node => node.props.testID === ASSISTANT_SWITCH_BUTTON_TEST_ID)

beforeEach(() => {
    mockState = { smallScreenNavigation: false }
    mockDispatch.mockClear()
})

describe('AssistantSwitchControl (AT-2430)', () => {
    it('renders nothing when there is nothing to switch to', () => {
        expect(findButton(render({ groups: [] }))).toBeUndefined()
        expect(findButton(render({ groups: [groupOf('p1', 'a1')] }))).toBeUndefined()
    })

    it('switches straight to the other assistant with exactly two options', () => {
        const onSelect = jest.fn()
        const tree = render({
            groups: [groupOf('p1', 'a1', 'a2')],
            activeProjectId: 'p1',
            activeAssistantId: 'a1',
            onSelect,
        })

        const button = findButton(tree)
        expect(button).toBeDefined()
        // No popover: the whole point of two options is one click.
        expect(tree.root.findAllByType('AppPopover')).toHaveLength(0)

        const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
        act(() => button.props.onPress(event))

        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect.mock.calls[0][0].assistantId).toBe('a2')
        // The collapsed layout nests this button inside the row's own press target, whose job is
        // to expand the line — the switch must not trigger it.
        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        // A direct toggle is not a popup, so it must not claim the float-popup lock.
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('opens the popup from three options and selects nothing by itself', () => {
        const onSelect = jest.fn()
        const tree = render({
            groups: [groupOf('p1', 'a1', 'a2', 'a3')],
            activeProjectId: 'p1',
            activeAssistantId: 'a1',
            onSelect,
        })

        const popover = tree.root.findByType('AppPopover')
        expect(popover.props.isOpen).toBe(false)

        act(() => findButton(tree).props.onPress({ preventDefault: jest.fn(), stopPropagation: jest.fn() }))

        expect(tree.root.findByType('AppPopover').props.isOpen).toBe(true)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Show float popup' })
        expect(onSelect).not.toHaveBeenCalled()
    })

    it('passes the grouping flag and the live selection through to the popup', () => {
        const onSelect = jest.fn()
        const groups = [groupOf('p1', 'a1', 'a2'), groupOf('p2', 'a3')]
        const tree = render({ groups, grouped: true, activeProjectId: 'p1', activeAssistantId: 'a2', onSelect })

        const modal = tree.root.findByType('AppPopover').props.content
        expect(modal.props.grouped).toBe(true)
        expect(modal.props.groups).toBe(groups)
        expect(modal.props.activeProjectId).toBe('p1')
        expect(modal.props.activeAssistantId).toBe('a2')
        expect(modal.props.onSelect).toBe(onSelect)
    })

    it('releases the float-popup lock when the popup is dismissed', () => {
        const tree = render({ groups: [groupOf('p1', 'a1', 'a2', 'a3')], activeAssistantId: 'a1' })

        act(() => findButton(tree).props.onPress({ preventDefault: jest.fn(), stopPropagation: jest.fn() }))
        mockDispatch.mockClear()
        act(() => tree.root.findByType('AppPopover').props.onClickOutside())

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Hide float popup' })
        expect(tree.root.findByType('AppPopover').props.isOpen).toBe(false)
    })

    it('counts options across every project group, not just the first', () => {
        // Two projects with one assistant each is still two options, and therefore a toggle.
        const tree = render({ groups: [groupOf('p1', 'a1'), groupOf('p2', 'a2')], activeAssistantId: 'a1' })
        expect(findButton(tree)).toBeDefined()
        expect(tree.root.findAllByType('AppPopover')).toHaveLength(0)
    })
})
