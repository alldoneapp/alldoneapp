/**
 * @jest-environment jsdom
 */

import React from 'react'
import moment from 'moment'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import RecurringTaskDateBasisModal from './RecurringTaskDateBasisModal'

// AT-2803: the completion popup of a postponed / overdue recurring task.

let mockCalendarProps = null

jest.mock('react-redux', () => ({ useSelector: selector => selector({ smallScreenNavigation: false }) }))
jest.mock('react-hot-keys', () => props => props.children)
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../UIControls/Shortcut', () => {
    const { Text } = require('react-native')
    return ({ text }) => <Text>{`[${text}]`}</Text>
})
jest.mock('../../../UIControls/CustomScrollView', () => props => props.children)
jest.mock('../DueDateModal/Header', () => () => null)
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
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
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
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('offers the original date, the current due date, today and a custom date', () => {
        const { tree } = renderModal(postponedTask)

        const rows = rowTexts(tree)
        expect(rows).toHaveLength(4)
        expect(rows[0]).toContain('Original date')
        expect(rows[0]).toContain('Mon, 26 Oct')
        expect(rows[0]).toContain('[1]')
        expect(rows[1]).toContain('Current due date')
        expect(rows[1]).toContain('Fri, 30 Oct')
        expect(rows[1]).toContain('[2]')
        expect(rows[2]).toContain('Today')
        expect(rows[2]).toContain('Wed, 28 Oct')
        expect(rows[3]).toContain('Custom date')
        expect(rows[3]).toContain('[4]')
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
        expect(rows[0]).toContain('Current due date')
        expect(rows[1]).toContain('Today')
        expect(rows[2]).toContain('Custom date')
        expect(rows[2]).toContain('[3]')
    })
})
