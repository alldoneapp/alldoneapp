/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import FixedDueDatesModal from './FixedDueDatesModal'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))

jest.mock('react-hot-keys', () => {
    const MockHotkeys = props => props.children
    return MockHotkeys
})
jest.mock('../../../UIControls/Shortcut', () => () => null)
jest.mock('./DateItemSection', () => () => null)
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
}))
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))
jest.mock('../../../../redux/actions', () => ({
    setLastSelectedDueDate: value => ({ type: 'SET_LAST_SELECTED_DUE_DATE', value }),
    setSelectedTasks: () => ({ type: 'SET_SELECTED_TASKS' }),
}))
jest.mock('../../../../utils/BackendBridge', () => ({}))
jest.mock('../../../../utils/backends/Goals/goalsFirestore', () => ({
    getPreviousMilestone: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskToBacklog: jest.fn(),
}))

const DateItemSection = require('./DateItemSection')
const Hotkeys = require('react-hot-keys')

describe('FixedDueDatesModal', () => {
    let tree

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-11-13T12:16:00'))
        useDispatch.mockReturnValue(jest.fn())
        useSelector.mockImplementation(selector => selector({ smallScreenNavigation: false }))
        act(() => {
            tree = renderer.create(<FixedDueDatesModal task={{ id: 't1', dueDate: 0 }} projectId="p1" />)
        })
    })

    afterEach(() => {
        act(() => tree.unmount())
        jest.useRealTimers()
    })

    test('offers "In 14 days" between "In 7 days" and "In 30 days" with renumbered shortcuts', () => {
        const presets = tree.root.findAllByType(DateItemSection).map(node => node.props.dateData)

        expect(presets.map(({ text, shortcut }) => [text, shortcut])).toEqual([
            ['Today', '1'],
            ['Tomorrow', '2'],
            ['This next Saturday', '3'],
            ['This next Monday', '4'],
            ['In 2 days', '5'],
            ['In 4 days', '6'],
            ['In 7 days', '7'],
            ['In 14 days', '8'],
            ['In 30 days', '9'],
        ])
    })

    test('"In 14 days" is 14 calendar days after the same reference as the other presets', () => {
        const presets = tree.root.findAllByType(DateItemSection).map(node => node.props.dateData)
        const byText = Object.fromEntries(presets.map(preset => [preset.text, preset.date]))

        expect(byText['In 14 days'].format('YYYY-MM-DD')).toBe('2026-11-27')
        expect(byText['In 14 days'].diff(byText['Today'], 'days')).toBe(14)
        expect(byText['In 14 days'].diff(byText['In 7 days'], 'days')).toBe(7)
        expect(byText['In 14 days'].isSame(moment().add(14, 'day'), 'day')).toBe(true)
    })

    test('Someday moves to shortcut 0 and no preset shortcut is used twice', () => {
        const presetKeys = tree.root.findAllByType(DateItemSection).map(node => node.props.dateData.shortcut)
        const otherKeys = tree.root.findAllByType(Hotkeys).map(node => node.props.keyName)

        expect(otherKeys).toEqual(['0'])
        const allKeys = [...presetKeys, ...otherKeys]
        expect(new Set(allKeys).size).toBe(allKeys.length)
    })
})
