import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity, Text } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import GoalFocusAreaTag from './GoalFocusAreaTag'
import { setGoalFocusArea } from '../../utils/backends/Goals/goalFocusAreas'

jest.mock('react-redux', () => ({ useSelector: jest.fn(), useDispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'show' }),
    hideFloatPopup: () => ({ type: 'hide' }),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../GoalsView/FocusAreaPicker', () => 'FocusAreaPicker')
jest.mock('../../utils/backends/Goals/goalFocusAreas', () => ({ setGoalFocusArea: jest.fn() }))
jest.mock('../UIComponents/ModalShell/AppPopover', () => ({ children, content, isOpen, onClickOutside }) => (
    <section onClickOutside={onClickOutside}>
        {children}
        {isOpen && content}
    </section>
))

describe('goal focus area tag', () => {
    let tree
    const dispatch = jest.fn()
    const goal = { id: 'goal', focusAreaId: 'm' }
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector =>
            selector({ loggedUserProjectsMap: { p: { focusAreas: { m: { name: 'Marketing' } } } } })
        )
    })
    afterEach(() => act(() => tree?.unmount()))

    test('does not add a General tag to unassigned goal headings', () => {
        act(() => {
            tree = renderer.create(<GoalFocusAreaTag projectId="p" goal={{ id: 'goal' }} />)
        })
        expect(tree.toJSON()).toBeNull()
        act(() => tree.update(<GoalFocusAreaTag projectId="p" goal={{ id: 'goal' }} showEmpty />))
        expect(tree.root.findByType(Text).props.children).toBe('None (General)')
    })

    test('saves the selected area to the goal and releases its popup lock exactly once', async () => {
        act(() => {
            tree = renderer.create(<GoalFocusAreaTag projectId="p" goal={goal} />)
        })
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())
        const picker = tree.root.findByType('FocusAreaPicker')
        await act(async () => picker.props.onChange(null))
        expect(setGoalFocusArea).toHaveBeenCalledWith('p', 'goal', null)
        act(() => {
            picker.props.onClose()
            tree.root.findByType('section').props.onClickOutside()
        })
        act(() => tree.unmount())
        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['show', 'hide'])
    })

    test('drafts update locally and an open popup releases its lock when the goal moves groups', async () => {
        const onChange = jest.fn()
        act(() => {
            tree = renderer.create(<GoalFocusAreaTag projectId="p" goal={goal} onChange={onChange} />)
        })
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())
        await act(async () => tree.root.findByType('FocusAreaPicker').props.onChange('p'))
        expect(onChange).toHaveBeenCalledWith('p')
        expect(setGoalFocusArea).not.toHaveBeenCalled()
        act(() => tree.unmount())
        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['show', 'hide'])
    })
})
