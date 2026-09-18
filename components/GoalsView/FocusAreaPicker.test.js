import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import FocusAreaPicker from './FocusAreaPicker'
import {
    deleteProjectFocusArea,
    ensureProjectFocusArea,
    renameProjectFocusArea,
} from '../../utils/backends/Goals/goalFocusAreas'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../UIComponents/FloatModals/ModalHeader', () => 'ModalHeader')
jest.mock('../../hooks/useModalSizing', () => () => ({ width: 432, maxHeight: 700 }))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values) => (values?.name ? `Create ${values.name}` : text),
}))
jest.mock('../ModalsManager/modalsManager', () => ({ storeModal: jest.fn(), removeModal: jest.fn() }))
jest.mock('../../utils/backends/Goals/goalFocusAreas', () => ({
    ensureProjectFocusArea: jest.fn(),
    renameProjectFocusArea: jest.fn(),
    deleteProjectFocusArea: jest.fn(),
}))

describe('focus area picker', () => {
    let tree
    let onChange
    let onClose
    const button = label =>
        tree.root
            .findAllByType(TouchableOpacity)
            .find(node => node.findAllByType(Text).some(text => text.props.children === label))
    const type = value => act(() => tree.root.findByType(TextInput).props.onChangeText(value))

    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector =>
            selector({
                loggedUserProjectsMap: { p: { focusAreas: { m: { name: 'Marketing' }, p: { name: 'Product' } } } },
            })
        )
        onChange = jest.fn().mockResolvedValue()
        onClose = jest.fn()
        act(() => {
            tree = renderer.create(
                <FocusAreaPicker projectId="p" selectedId="m" onChange={onChange} onClose={onClose} />
            )
        })
    })
    afterEach(() => act(() => tree.unmount()))

    test('reuses an existing area and clears the optional value', async () => {
        type(' PRODUCT ')
        await act(async () => tree.root.findByType(TextInput).props.onSubmitEditing())
        expect(onChange).toHaveBeenLastCalledWith('p')
        expect(ensureProjectFocusArea).not.toHaveBeenCalled()
        await act(async () => button('None (General)').props.onPress())
        expect(onChange).toHaveBeenLastCalledWith(null)
    })

    test('creates a reusable area and selects the returned ID', async () => {
        ensureProjectFocusArea.mockResolvedValue({ id: 'new', name: 'Customer Success' })
        type(' Customer   Success ')
        await act(async () => button('Create Customer Success').props.onPress())
        expect(ensureProjectFocusArea).toHaveBeenCalledWith('p', 'Customer Success')
        expect(onChange).toHaveBeenCalledWith('new')
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    test('keeps the picker open and preserves input when saving fails', async () => {
        ensureProjectFocusArea.mockRejectedValue(new Error('offline'))
        type('Partnerships')
        await act(async () => tree.root.findByType(TextInput).props.onSubmitEditing())
        expect(onClose).not.toHaveBeenCalled()
        expect(onChange).not.toHaveBeenCalled()
        expect(tree.root.findByType(TextInput).props.value).toBe('Partnerships')
        expect(tree.root.findAllByType(Text).some(text => text.props.accessibilityRole === 'alert')).toBe(true)
    })

    test('renames the shared record without reassigning the goal', async () => {
        renameProjectFocusArea.mockResolvedValue({ id: 'm', name: 'Growth' })
        act(() =>
            tree.root
                .findAllByType(TouchableOpacity)
                .find(node => node.props.accessibilityLabel === 'Rename focus area: Marketing')
                .props.onPress()
        )
        type('Growth')
        await act(async () => button('Save').props.onPress())
        expect(renameProjectFocusArea).toHaveBeenCalledWith('p', 'm', 'Growth')
        expect(onChange).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
    })

    test('owns Enter so the parent goal form does not submit', () => {
        const event = { key: 'Enter', stopPropagation: jest.fn() }
        tree.root.findByType('div').props.onKeyDown(event)
        expect(event.stopPropagation).toHaveBeenCalledTimes(1)
        expect(onClose).not.toHaveBeenCalled()
    })

    const askToDelete = () =>
        act(() =>
            tree.root
                .findAllByType(TouchableOpacity)
                .find(node => node.props.accessibilityLabel === 'Delete focus area: Marketing')
                .props.onPress()
        )

    test('requires confirmation and lets the user cancel without changing the catalog', () => {
        askToDelete()
        expect(deleteProjectFocusArea).not.toHaveBeenCalled()
        expect(tree.root.findAllByType(TextInput)).toHaveLength(0)
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain(
            'Goals in this focus area will appear in General. No goals will be deleted.'
        )
        act(() => button('Cancel').props.onPress())
        expect(tree.root.findAllByType(TextInput)).toHaveLength(1)
        expect(deleteProjectFocusArea).not.toHaveBeenCalled()
    })

    test('deletes the shared area without deleting or rewriting any goal', async () => {
        deleteProjectFocusArea.mockResolvedValue()
        askToDelete()
        await act(async () => button('Delete focus area').props.onPress())
        expect(deleteProjectFocusArea).toHaveBeenCalledWith('p', 'm')
        expect(onChange).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
        expect(tree.root.findAllByType(TextInput)).toHaveLength(1)
    })

    test('preserves the deletion confirmation on failure so it can be retried', async () => {
        deleteProjectFocusArea.mockRejectedValue(new Error('offline'))
        askToDelete()
        await act(async () => button('Delete focus area').props.onPress())
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain(
            'Could not delete the focus area. Please try again.'
        )
        expect(tree.root.findAllByType(TextInput)).toHaveLength(0)
        expect(onChange).not.toHaveBeenCalled()
    })

    test('shows General as selected when the assigned catalog entry has been deleted', () => {
        useSelector.mockImplementation(selector => selector({ loggedUserProjectsMap: { p: { focusAreas: {} } } }))
        act(() => tree.update(<FocusAreaPicker projectId="p" selectedId="m" onChange={onChange} onClose={onClose} />))
        expect(button('None (General)').findByType('Icon').props.name).toBe('check')
    })
})
