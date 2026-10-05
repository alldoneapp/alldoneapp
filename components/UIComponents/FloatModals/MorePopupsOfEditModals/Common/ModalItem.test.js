import React from 'react'
import renderer from 'react-test-renderer'
import Hotkeys from 'react-hot-keys'
import { TouchableOpacity } from 'react-native-gesture-handler'

import ModalItem from './ModalItem'

jest.mock('react-redux', () => ({ useSelector: () => false }))
jest.mock('react-hot-keys', () => 'Hotkeys')
jest.mock('react-native-gesture-handler', () => ({ TouchableOpacity: 'TouchableOpacity' }))
jest.mock('../../../../Icon', () => 'Icon')
jest.mock('../../../../UIControls/Shortcut', () => ({ __esModule: true, default: 'Shortcut' }))

it('blocks both clicks and keyboard shortcuts for a disabled menu item', () => {
    const press = jest.fn()
    const tree = renderer.create(
        <ModalItem icon="flag" text="Prioritize tasks" shortcut="2" onPress={press} disabled />
    )
    const touch = tree.root.findByType(TouchableOpacity)
    expect(touch.props.disabled).toBe(true)
    expect(touch.props.onPress).toBeUndefined()
    tree.root.findByType(Hotkeys).props.onKeyDown('2', {})
    expect(press).not.toHaveBeenCalled()
    tree.unmount()
})

it('preserves click and keyboard actions for an enabled menu item', () => {
    const press = jest.fn()
    const tree = renderer.create(<ModalItem icon="flag" text="Prioritize tasks" shortcut="2" onPress={press} />)
    tree.root.findByType(TouchableOpacity).props.onPress()
    const event = {}
    tree.root.findByType(Hotkeys).props.onKeyDown('2', event)
    expect(press).toHaveBeenCalledTimes(2)
    expect(press).toHaveBeenLastCalledWith(event)
    tree.unmount()
})
