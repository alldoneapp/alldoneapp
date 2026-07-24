/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import OKRItem from './OKRItem'
import { setUserOKRHiddenInAllProjectsToday } from '../../../utils/backends/Users/usersFirestore'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector(mockState)),
}))

jest.mock('react-tiny-popover', () => ({ children }) => children)

jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(textKey => textKey),
}))

jest.mock('../../../utils/HelperFunctions', () => ({
    popoverToSafePosition: jest.fn(),
}))

jest.mock('../../Icon', () => props => {
    const React = require('react')
    const { Text } = require('react-native')
    return <Text>{props.name}</Text>
})

jest.mock('../../../utils/backends/OKRs/okrsFirestore', () => ({
    updateOKRCurrentValue: jest.fn(),
}))

jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    clearUserOKRHiddenInAllProjectsToday: jest.fn(),
    setUserOKRHiddenInAllProjectsToday: jest.fn(),
}))

jest.mock('./OKRModal', () => () => null)

jest.mock('./useOkrRevenueValue', () => () => ({
    currentValue: 0,
    missingHourlyRate: false,
}))

const projectId = 'project-1'
const okr = {
    id: 'okr-1',
    label: 'Visible OKR',
    currentValue: 1,
    targetValue: 10,
    unit: '',
    cadence: 'monthly',
    periodStart: Date.now() - 1000,
    periodEnd: Date.now() + 100000,
    isPublicFor: [0],
}

let mockState

const createState = () => ({
    smallScreenNavigation: false,
    loggedUser: {
        uid: 'user-1',
        timezoneName: 'Europe/Berlin',
    },
})

const findDoneForTodayButtons = tree =>
    tree.root.findAll(
        node =>
            node.props.accessibilityLabel === 'Hide OKR in All Projects for today' &&
            typeof node.props.onPress === 'function'
    )

describe('OKRItem', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = createState()
    })

    it('shows done for today for visible OKRs in a selected project', () => {
        const tree = renderer.create(
            <OKRItem projectId={projectId} okr={okr} canUpdate inAllProjects={false} hiddenInAllProjectsToday={false} />
        )

        expect(tree.root.findAllByType(Text).filter(node => node.props.children === 'Done for today')).toHaveLength(1)
        expect(findDoneForTodayButtons(tree)).toHaveLength(1)
    })

    it('marks a selected-project OKR done for today from the row action', () => {
        const tree = renderer.create(
            <OKRItem projectId={projectId} okr={okr} canUpdate inAllProjects={false} hiddenInAllProjectsToday={false} />
        )

        findDoneForTodayButtons(tree)[0].props.onPress()

        expect(setUserOKRHiddenInAllProjectsToday).toHaveBeenCalledWith('user-1', projectId, okr.id, expect.any(String))
    })
})
