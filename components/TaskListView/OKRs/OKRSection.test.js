/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text, View } from 'react-native'
import renderer from 'react-test-renderer'

import OKRSection from './OKRSection'
import { clearUserOKRsHiddenInAllProjectsToday } from '../../../utils/backends/Users/usersFirestore'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector(mockState)),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(textKey => textKey),
}))

jest.mock('./OKRItem', () => ({
    __esModule: true,
    default: ({ okr }) => {
        const React = require('react')
        const { Text, View } = require('react-native')
        return (
            <View testID="okr-row">
                <Text>{okr.label}</Text>
            </View>
        )
    },
    OKREmptyItem: () => {
        const React = require('react')
        const { Text, View } = require('react-native')
        return (
            <View testID="okr-empty-item">
                <Text>Add OKR</Text>
            </View>
        )
    },
}))

jest.mock('./okrHelper', () => ({
    getOkrAllProjectsTodayKey: jest.fn(() => '2026-05-25'),
    getOkrUserTimezone: jest.fn(() => 'Europe/Berlin'),
}))

jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: {
        accessGranted: jest.fn(() => true),
    },
}))

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false),
    },
}))

jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    clearUserOKRsHiddenInAllProjectsToday: jest.fn(),
    setUserOKRPrivacyMode: jest.fn(),
}))

const projectId = 'project-1'
const baseOkr = { id: 'okr-1', label: 'Visible OKR' }
const hiddenOkr = { id: 'okr-2', label: 'Hidden OKR' }

let mockState

const createState = ({ okrs = [baseOkr], hiddenTodayById = {}, smallScreenNavigation = false } = {}) => ({
    okrsByProjectInTasks: {
        [projectId]: okrs,
    },
    loggedUser: {
        uid: 'user-1',
        timezoneName: 'Europe/Berlin',
        okrsHiddenInAllProjectsTodayByProjectAndOkr: {
            [projectId]: hiddenTodayById,
        },
    },
    currentUser: {
        uid: 'user-1',
    },
    smallScreenNavigation,
})

const findUndoAllButtons = tree =>
    tree.root.findAll(
        node => node.props.accessibilityLabel === 'Undo all OKRs for today' && typeof node.props.onPress === 'function'
    )

describe('OKRSection', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = createState()
    })

    it('renders selected-project OKRs that are not done for today', () => {
        mockState = createState({ okrs: [baseOkr, hiddenOkr], hiddenTodayById: { [hiddenOkr.id]: '2026-05-25' } })

        const tree = renderer.create(<OKRSection projectId={projectId} inAllProjects={false} />)

        expect(tree.root.findAllByType(Text).filter(node => node.props.children === baseOkr.label)).toHaveLength(1)
        expect(tree.root.findAllByType(Text).filter(node => node.props.children === hiddenOkr.label)).toHaveLength(0)
        expect(findUndoAllButtons(tree)).toHaveLength(1)
    })

    it('keeps the selected-project OKR header visible when every OKR is done for today', () => {
        mockState = createState({ okrs: [hiddenOkr], hiddenTodayById: { [hiddenOkr.id]: '2026-05-25' } })

        const tree = renderer.create(<OKRSection projectId={projectId} inAllProjects={false} />)

        expect(tree.root.findAllByType(Text).filter(node => node.props.children === hiddenOkr.label)).toHaveLength(0)
        expect(tree.root.findByProps({ testID: 'okr-empty-item' })).toBeTruthy()
        expect(findUndoAllButtons(tree)).toHaveLength(1)
    })

    it('does not render the selected-project OKR section when the project has no OKRs', () => {
        mockState = createState({ okrs: [] })

        const tree = renderer.create(<OKRSection projectId={projectId} inAllProjects={false} />).toJSON()

        expect(tree).toBeNull()
    })

    it('preserves All Projects behavior by hiding the section when all OKRs are done for today', () => {
        mockState = createState({ okrs: [hiddenOkr], hiddenTodayById: { [hiddenOkr.id]: '2026-05-25' } })

        const tree = renderer.create(<OKRSection projectId={projectId} inAllProjects />).toJSON()

        expect(tree).toBeNull()
    })

    it('filters done-for-today OKRs in All Projects without showing undo all', () => {
        mockState = createState({ okrs: [baseOkr, hiddenOkr], hiddenTodayById: { [hiddenOkr.id]: '2026-05-25' } })

        const tree = renderer.create(<OKRSection projectId={projectId} inAllProjects />)

        expect(tree.root.findAllByType(Text).filter(node => node.props.children === baseOkr.label)).toHaveLength(1)
        expect(tree.root.findAllByType(Text).filter(node => node.props.children === hiddenOkr.label)).toHaveLength(0)
        expect(findUndoAllButtons(tree)).toHaveLength(0)
    })

    it('clears only OKRs hidden for today when undoing all OKRs for today', () => {
        mockState = createState({
            okrs: [baseOkr, hiddenOkr, { id: 'stale-okr', label: 'Stale OKR' }],
            hiddenTodayById: {
                [hiddenOkr.id]: '2026-05-25',
                'stale-okr': '2026-05-24',
            },
        })

        const tree = renderer.create(<OKRSection projectId={projectId} inAllProjects={false} />)
        findUndoAllButtons(tree)[0].props.onPress()

        expect(clearUserOKRsHiddenInAllProjectsToday).toHaveBeenCalledWith('user-1', projectId, [hiddenOkr.id])
    })
})
