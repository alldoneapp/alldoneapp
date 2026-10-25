import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUser: { uid: 'me', themeName: 'modern', numberUsersSidebar: 0 },
    currentUser: { uid: 'me' },
    projectUsers: {},
    projectContacts: {},
    projectWorkstreams: {},
    projectAssistants: {},
    globalAssistants: [],
}

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../../../hooks/useProjectData', () => () => {})
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectById: () => ({ isTemplate: false }) },
}))
jest.mock('../../../../Themes/Themes', () => ({ getTheme: () => ({ userList: () => ({}), showMore: () => ({}) }) }))
jest.mock('../../Themes', () => ({ Themes: {} }))
jest.mock('../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws@' }))
jest.mock(
    '../../Items/UserItem',
    () =>
        ({ user }) =>
            `user:${user.uid}`
)
jest.mock(
    '../../Items/ContactItem',
    () =>
        ({ contact }) =>
            `contact:${contact.uid}`
)
jest.mock(
    '../../Items/AssistantItem',
    () =>
        ({ assistant }) =>
            `assistant:${assistant.uid}`
)
jest.mock(
    '../../Items/WorkstreamItem',
    () =>
        ({ workstream }) =>
            `workstream:${workstream.uid}`
)
jest.mock(
    '../../Items/WikiItem',
    () =>
        ({ projectId }) =>
            `wiki:${projectId}`
)
jest.mock('../InvitePeople/InvitePeopleWrapper', () => () => 'settings')
jest.mock(
    '../../../UIControls/ShowMoreButton',
    () =>
        ({ expanded }) =>
            expanded ? 'show less' : 'show more'
)

import TasksBoards from './TasksBoards'

const rows = component => {
    const flatten = node => (typeof node === 'string' ? [node] : (node?.children || []).flatMap(flatten))
    return flatten(component.toJSON())
}

function mount(props = {}) {
    let component
    act(() => {
        component = renderer.create(
            <TasksBoards
                projectId="p1"
                projectColor="#39CCCC"
                projectIndex={0}
                projectType="active"
                isShared={false}
                globalAssistantIds={[]}
                {...props}
            />
        )
    })
    return component
}

beforeEach(() => {
    mockState.loggedUser.numberUsersSidebar = 0
    mockState.projectUsers = { p1: [{ uid: 'me' }, { uid: 'derek' }, { uid: 'luis' }] }
})

describe('TasksBoards', () => {
    it('lists the wiki under the people, directly above the project settings', () => {
        expect(rows(mount())).toEqual(['user:me', 'user:derek', 'user:luis', 'wiki:p1', 'settings'])
    })

    it('keeps the wiki in reach when the people are cut off behind "show more"', () => {
        mockState.loggedUser.numberUsersSidebar = 2

        expect(rows(mount())).toEqual(['user:me', 'user:derek', 'wiki:p1', 'show more'])
    })

    it('has no wiki for a guest of a shared project', () => {
        expect(rows(mount({ isShared: true }))).not.toContain('wiki:p1')
    })
})
