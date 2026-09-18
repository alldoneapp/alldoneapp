/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import GoalMoreButton from '../Goals/GoalMoreButton'
import NoteMoreButton from '../Notes/NoteMoreButton'
import ContactMoreButton from '../Contacts/ContactMoreButton'
import ChatsMoreButton from '../Chats/ChatsMoreButton'

const mockState = {
    currentUser: { uid: 'user-1' },
    loggedUser: { uid: 'user-1' },
    loggedUserProjects: [],
    selectedProjectIndex: -1,
    notesActiveTab: 0,
    contactsActiveTab: 0,
    chatsActiveTab: 0,
}

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('./MoreButtonWrapper', () => {
    const React = require('react')
    const { View } = require('react-native')
    return React.forwardRef(({ children }, ref) => {
        React.useImperativeHandle(ref, () => ({ close: jest.fn() }))
        return <View>{children}</View>
    })
})
jest.mock('./OpenProjectModalItem', () => 'OpenProjectModalItem')
jest.mock('./OpenInNewWindowModalItem', () => 'OpenInNewWindowModalItem')
jest.mock('../../MorePopupsOfEditModals/Common/CopyLinkModalItem', () => 'CopyLinkModalItem')
jest.mock('../../MorePopupsOfEditModals/Common/GenericModalItem', () => 'GenericModalItem')
jest.mock('../../MorePopupsOfEditModals/Common/ModalItem', () => 'ModalItem')
jest.mock('../../RichCreateTaskModal/RichCreateTaskModal', () => 'RichCreateTaskModal')
jest.mock('../../../../ModalsManager/modalsManager', () => ({
    removeModal: jest.fn(),
    storeModal: jest.fn(),
    RICH_CREATE_TASK_MODAL_ID: 'rich-create-task',
}))
jest.mock('../../../../Feeds/Utils/FeedsConstants', () => ({ FOLLOWED_TAB: 1, FEED_PUBLIC_FOR_ALL: 0 }))
jest.mock('../../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getNewDefaultTask: jest.fn(() => ({})) },
    RECURRENCE_WEEKLY: 'weekly',
}))
jest.mock('../../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../../../../redux/actions', () => ({ hideFloatPopup: jest.fn(), showFloatPopup: jest.fn() }))
jest.mock('../../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../../utils/backends/Chats/chatsComments', () => ({ markMessagesAsRead: jest.fn() }))
jest.mock('../../../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => mockState },
}))

const projectId = 'project-1'
const findOpenProject = tree => tree.root.findByType('OpenProjectModalItem')

describe('main-view project menus', () => {
    it.each([
        ['Goals', <GoalMoreButton projectId={projectId} />],
        ['Notes', <NoteMoreButton projectId={projectId} user={{ uid: 'user-1' }} />],
        ['Contacts', <ContactMoreButton projectId={projectId} user={{ uid: 'user-1' }} />],
        ['Chats', <ChatsMoreButton projectId={projectId} userId="user-1" />],
    ])('starts the %s project menu with the shared Open Project action', (name, component) => {
        const tree = renderer.create(component)

        expect(findOpenProject(tree).props).toMatchObject({ projectId, shortcut: '1' })
        expect(tree.root.findByType('CopyLinkModalItem').props.shortcut).toBe('2')
    })
})
