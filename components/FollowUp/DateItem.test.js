/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import DateItem from './DateItem'

jest.mock('react-hot-keys', () => {
    const MockHotkeys = props => props.children
    return MockHotkeys
})
jest.mock('../Icon', () => () => null)
jest.mock('../UIControls/Shortcut', () => () => null)
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: text => text,
}))
jest.mock('../../redux/store', () => ({
    getState: () => ({ smallScreenNavigation: false, lastSelectedDueDate: 0 }),
    subscribe: () => () => {},
}))

const Hotkeys = require('react-hot-keys')

const LABELS = [
    'Today',
    'Tomorrow',
    'This next Saturday',
    'This next Monday',
    'In 2 days',
    'In 4 days',
    'In 7 days',
    'In 14 days',
    'In 30 days',
    'Someday',
    'Last selected',
    'Custom date',
]

const renderItem = (label, onPress = jest.fn()) => {
    let tree
    act(() => {
        tree = renderer.create(<DateItem onPress={onPress}>{label}</DateItem>)
    })
    return tree
}

describe('FollowUp DateItem', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-11-13T12:16:00'))
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('assigns renumbered, unique shortcuts with "In 14 days" on 8', () => {
        const keys = LABELS.map(label => {
            const tree = renderItem(label)
            const key = tree.root.findByType(Hotkeys).props.keyName
            act(() => tree.unmount())
            return key
        })

        expect(Object.fromEntries(LABELS.map((label, i) => [label, keys[i]]))).toEqual({
            Today: '1',
            Tomorrow: '2',
            'This next Saturday': '3',
            'This next Monday': '4',
            'In 2 days': '5',
            'In 4 days': '6',
            'In 7 days': '7',
            'In 14 days': '8',
            'In 30 days': '9',
            Someday: '0',
            'Last selected': 'C',
            'Custom date': 'Q',
        })
        expect(new Set(keys).size).toBe(keys.length)
    })

    test('"In 14 days" selects a date 14 calendar days from now', () => {
        const onPress = jest.fn()
        const tree = renderItem('In 14 days', onPress)

        act(() => {
            tree.root.findByType(Hotkeys).props.onKeyDown('8', { preventDefault() {}, stopPropagation() {} })
        })

        expect(onPress).toHaveBeenCalledTimes(1)
        const [text, date] = onPress.mock.calls[0]
        expect(text).toBe('In 14 days')
        expect(date.format('YYYY-MM-DD')).toBe('2026-11-27')
        act(() => tree.unmount())
    })
})
