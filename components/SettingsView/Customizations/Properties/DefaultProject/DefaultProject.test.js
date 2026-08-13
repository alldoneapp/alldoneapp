import React from 'react'
import renderer, { act } from 'react-test-renderer'

import DefaultProject from './DefaultProject'
import { setDefaultProjectId } from '../../../../../utils/backends/Users/usersFirestore'

const mockOwnProject = { id: 'own-project', creatorId: 'user-1', name: 'Own project' }
const mockOtherUsersProject = { id: 'other-project', creatorId: 'user-2', name: 'Shared project' }

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false })),
}))
jest.mock('uuid/v4', () => () => 'watcher-key')
jest.mock('../../../../UIComponents/ModalShell/AppPopover', () => ({ content, children }) => (
    <>
        {children}
        {content}
    </>
))
jest.mock('../../../../Icon', () => 'MockIcon')
jest.mock('../../../../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: { Text03: '#333' },
}))
jest.mock('../../../../UIControls/Button', () => 'MockButton')
jest.mock('../../../../UIComponents/FloatModals/ProjectListModal/ProjectListModal', () => 'MockProjectListModal')
jest.mock('../../../ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getActiveProjects2: projects => projects },
}))
jest.mock('../../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
    watchProject: jest.fn(),
    watchActiveAndArchivedProjects: jest.fn((userId, watcherKey, callback) =>
        callback([mockOwnProject, mockOtherUsersProject])
    ),
}))
jest.mock('../../../../../utils/backends/Users/usersFirestore', () => ({
    setDefaultProjectId: jest.fn(),
}))

describe('DefaultProject', () => {
    const user = {
        uid: 'user-1',
        defaultProjectId: '',
        projectIds: ['own-project', 'other-project'],
        archivedProjectIds: [],
        templateProjectIds: [],
        guideProjectIds: [],
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('offers and allows selection of an owned project', () => {
        let tree
        act(() => {
            tree = renderer.create(<DefaultProject user={user} />)
        })

        const picker = tree.root.findByType('MockProjectListModal')
        expect(picker.props.projects).toEqual([mockOwnProject])

        act(() => picker.props.onSelectProject(mockOwnProject))
        expect(setDefaultProjectId).toHaveBeenCalledWith('user-1', 'own-project')
    })

    test("rejects a forged selection of another user's project", () => {
        let tree
        act(() => {
            tree = renderer.create(<DefaultProject user={user} />)
        })

        const picker = tree.root.findByType('MockProjectListModal')
        act(() => picker.props.onSelectProject(mockOtherUsersProject))

        expect(setDefaultProjectId).not.toHaveBeenCalled()
    })
})
