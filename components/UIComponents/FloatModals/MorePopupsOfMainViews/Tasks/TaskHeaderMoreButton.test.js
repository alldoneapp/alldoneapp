/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import TaskHeaderMoreButton from './TaskHeaderMoreButton'
import { clearUserOKRsHiddenInAllProjectsToday } from '../../../../../utils/backends/Users/usersFirestore'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'

let mockState

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector(mockState)),
}))

jest.mock('../Common/MoreButtonWrapper', () => {
    const React = require('react')
    const { View } = require('react-native')
    return React.forwardRef(({ children }, ref) => {
        React.useImperativeHandle(ref, () => ({ close: jest.fn() }))
        return <View>{children}</View>
    })
})

jest.mock('../../MorePopupsOfEditModals/Common/ModalItem', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return props => <Text {...props}>{props.text}</Text>
})

jest.mock('../../MorePopupsOfEditModals/Common/CopyLinkModalItem', () => () => null)
jest.mock('../Common/OpenInNewWindowModalItem', () => () => null)
jest.mock('./SyncCalendarModalItem', () => () => null)
jest.mock('./DateBarOrganizeModalItem', () => () => null)
jest.mock('../../../../TaskListView/OKRs/OKRModal', () => () => null)
jest.mock('../../../../TaskListView/AutoPostpone/AutoPostponeTasksModal', () => () => null)
jest.mock('../../../../../utils/backends/openTasks', () => ({
    DATE_TASK_INDEX: 0,
    TODAY_DATE: '20260724',
}))
jest.mock('../../../../TaskListView/EmailLine/emailLineFeature', () => ({
    EMAIL_LINE_ENABLED: false,
}))
jest.mock('../../../../../utils/IntegrationProviders', () => ({
    listEmailConnections: jest.fn(() => []),
}))
jest.mock('../../../../../utils/backends/Users/usersFirestore', () => ({
    clearUserEmailLineHiddenTodayForConnections: jest.fn(),
    clearUserOKRsHiddenInAllProjectsToday: jest.fn(),
}))
jest.mock('../../../../TaskListView/OKRs/okrHelper', () => ({
    getOkrAllProjectsTodayKey: jest.fn(() => '2026-07-24'),
    getOkrUserTimezone: jest.fn(() => 'Europe/Berlin'),
}))
jest.mock('../../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        processURLProjectDetailsTab: jest.fn(),
    },
    checkIfSelectedAllProjects: jest.fn(() => false),
}))
jest.mock('../../../../../utils/NavigationService', () => ({}))

const projectId = 'project-1'
const okrs = [{ id: 'okr-1' }, { id: 'okr-2' }]

const createState = hiddenTodayById => ({
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: projectId }],
    okrsByProjectInTasks: { [projectId]: okrs },
    filteredOpenTasksStore: {},
    loggedUser: {
        uid: 'user-1',
        timezoneName: 'Europe/Berlin',
        okrsHiddenInAllProjectsTodayByProjectAndOkr: {
            [projectId]: hiddenTodayById,
        },
    },
})

const renderMenu = hiddenTodayById => {
    mockState = createState(hiddenTodayById)
    return renderer.create(<TaskHeaderMoreButton projectIdOverride={projectId} userId="user-1" />)
}

const findItems = tree => tree.root.findAll(node => typeof node.props.text === 'string')

describe('TaskHeaderMoreButton OKR actions', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('moves the remaining OKR actions into the project menu when all OKRs are done today', () => {
        const tree = renderMenu({
            'okr-1': '2026-07-24',
            'okr-2': '2026-07-24',
        })
        const labels = findItems(tree).map(node => node.props.text)

        expect(labels).toEqual(expect.arrayContaining(['History', 'Undo all OKRs for today', 'Add OKR']))
        expect(labels).not.toContain('Show all')
    })

    it('preserves the existing project menu when OKRs remain for today', () => {
        const tree = renderMenu({
            'okr-1': '2026-07-24',
        })
        const labels = findItems(tree).map(node => node.props.text)

        expect(labels).not.toContain('History')
        expect(labels).not.toContain('Undo all OKRs for today')
        expect(labels).not.toContain('Add OKR')
        expect(labels).not.toContain('Show all')
    })

    it('undoes every project OKR completed today from the project menu', () => {
        const tree = renderMenu({
            'okr-1': '2026-07-24',
            'okr-2': '2026-07-24',
        })
        const undoItem = findItems(tree).find(node => node.props.text === 'Undo all OKRs for today')

        undoItem.props.onPress()

        expect(clearUserOKRsHiddenInAllProjectsToday).toHaveBeenCalledWith('user-1', projectId, ['okr-1', 'okr-2'])
    })

    it('opens OKR history from the project menu', () => {
        const tree = renderMenu({
            'okr-1': '2026-07-24',
            'okr-2': '2026-07-24',
        })
        const historyItem = findItems(tree).find(node => node.props.text === 'History')

        historyItem.props.onPress()

        expect(ProjectHelper.processURLProjectDetailsTab).toHaveBeenCalledWith(
            expect.anything(),
            'PROJECT_OKRS',
            projectId
        )
    })
})
