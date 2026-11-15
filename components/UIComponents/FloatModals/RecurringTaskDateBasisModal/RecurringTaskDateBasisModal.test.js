/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import RecurringTaskDateBasisModal from './RecurringTaskDateBasisModal'

// AT-2803: the completion popup of a postponed / overdue recurring task.
// AT-3049: rows read "From …" and preview the next occurrence; the header names the rhythm.

let mockCalendarProps = null
let mockHeaderProps = null

jest.mock('react-redux', () => ({ useSelector: selector => selector({ smallScreenNavigation: false }) }))
jest.mock('react-hot-keys', () => props => props.children)
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../UIControls/Shortcut', () => {
    const { Text } = require('react-native')
    return ({ text }) => <Text>{`[${text}]`}</Text>
})
jest.mock('../../../UIControls/CustomScrollView', () => props => props.children)
jest.mock('../DueDateModal/Header', () => props => {
    mockHeaderProps = props
    return null
})
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    getRecurrenceInfo: recurrence => ({ large: { weekly: 'Weekly', daily: 'Daily' }[recurrence], interpolations: {} }),
}))
jest.mock('../DueDateModal/DueDateCalendarModalFooter', () => () => null)
jest.mock('../DueDateCalendarModal/DueDateCalendarModal', () => props => {
    mockCalendarProps = props
    return null
})
jest.mock('../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../../../../utils/useWindowSize', () => ({
    withWindowSizeHook: Component => props => <Component {...props} windowSize={[1200, 800]} />,
}))
jest.mock('../../../../utils/modalSafeArea', () => ({ getSafeAreaModalMaxHeight: height => height }))
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (text, values = {}) => text.replace(/{{(\w+)}}/g, (match, key) => values[key]),
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({
    RECURRENCE_DATE_BASIS_MODAL_ID: 'recurrence-date-basis',
    storeModal: jest.fn(),
    removeModal: jest.fn(),
}))

const at = value => moment(value).valueOf()
const NOW = at('2026-10-28T08:00:00')

const postponedTask = {
    id: 'task-1',
    recurrence: 'weekly',
    done: false,
    userIds: ['user-1'],
    startTime: '09:00',
    recurrenceOriginalDueDate: at('2026-10-26T09:00:00'),
    dueDate: at('2026-10-30T09:00:00'),
}

const renderModal = task => {
    const selectDateBasis = jest.fn()
    let tree
    act(() => {
        tree = renderer.create(
            <RecurringTaskDateBasisModal
                task={task}
                projectId="project-1"
                closePopover={jest.fn()}
                selectDateBasis={selectDateBasis}
            />
        )
    })
    return { tree, selectDateBasis }
}

const rowTexts = tree =>
    tree.root.findAllByType(TouchableOpacity).map(row =>
        row
            .findAllByType(Text)
            .map(node => [].concat(node.props.children).join(''))
            .join('')
    )

const press = (tree, index) =>
    act(() => {
        tree.root.findAllByType(TouchableOpacity)[index].props.onPress({ preventDefault() {}, stopPropagation() {} })
    })

describe('RecurringTaskDateBasisModal', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW)
        mockCalendarProps = null
        mockHeaderProps = null
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('offers each base date with a preview of the next occurrence it produces', () => {
        const { tree } = renderModal(postponedTask)

        const rows = rowTexts(tree)
        expect(rows).toHaveLength(4)
        // Original Mon 26 Oct + 1 week
        expect(rows[0]).toBe('From original date  →  Mon, 2 Nov[1]')
        // Current due date Fri 30 Oct + 1 week
        expect(rows[1]).toBe('From current due date  →  Fri, 6 Nov[2]')
        // Today Wed 28 Oct + 1 week
        expect(rows[2]).toBe('From today  →  Wed, 4 Nov[3]')
        // Nothing to preview before a day is picked
        expect(rows[3]).toBe('From custom date[4]')
    })

    test('the base dates themselves are no longer shown', () => {
        const rows = rowTexts(renderModal(postponedTask).tree).join('\n')
        expect(rows).not.toContain('26 Oct')
        expect(rows).not.toContain('30 Oct')
        expect(rows).not.toContain('28 Oct')
    })

    test('the header names the rhythm, in the list and in the calendar', () => {
        const { tree } = renderModal(postponedTask)
        expect(mockHeaderProps.description).toBe(
            'Choose the date the interval of the next recurring task is counted from Rhythm: Weekly'
        )

        press(tree, 3)
        expect(mockHeaderProps.description).toBe(
            'Select the custom base date for the next recurring task Rhythm: Weekly'
        )
    })

    test('an overdue daily task skips ahead from its stale due date', () => {
        const { tree } = renderModal({
            ...postponedTask,
            recurrence: 'daily',
            recurrenceOriginalDueDate: null,
            dueDate: at('2026-10-21T09:00:00'),
        })

        const rows = rowTexts(tree)
        // 21 Oct + k days at 09:00, first one after now (Wed 28 Oct 08:00) is today 09:00.
        expect(rows[0]).toBe('From current due date  →  Wed, 28 Oct[1]')
        expect(rows[1]).toBe('From today  →  Thu, 29 Oct[2]')
        expect(mockHeaderProps.description).toContain('Rhythm: Daily')
    })

    test.each([
        [0, '2026-10-26'],
        [1, '2026-10-30'],
        [2, '2026-10-28'],
    ])('row %i sends local noon of its day', (index, day) => {
        const { tree, selectDateBasis } = renderModal(postponedTask)

        press(tree, index)

        expect(selectDateBasis).toHaveBeenCalledTimes(1)
        expect(moment(selectDateBasis.mock.calls[0][0]).format('YYYY-MM-DD HH:mm')).toBe(`${day} 12:00`)
    })

    test('a custom date from the calendar is normalised the same way', () => {
        const { tree, selectDateBasis } = renderModal(postponedTask)

        press(tree, 3)
        act(() => {
            mockCalendarProps.saveDueDateBeforeSaveTask(at('2026-11-04T00:00:00'), false)
        })

        expect(moment(selectDateBasis.mock.calls[0][0]).format('YYYY-MM-DD HH:mm')).toBe('2026-11-04 12:00')
    })

    test('an overdue task without a stored original shows no original row', () => {
        const { tree } = renderModal({
            ...postponedTask,
            recurrenceOriginalDueDate: null,
            dueDate: at('2026-10-21T09:00:00'),
        })

        const rows = rowTexts(tree)
        expect(rows).toHaveLength(3)
        expect(rows[0]).toContain('From current due date')
        expect(rows[1]).toContain('From today')
        expect(rows[2]).toContain('From custom date')
        expect(rows[2]).toContain('[3]')
    })
})
