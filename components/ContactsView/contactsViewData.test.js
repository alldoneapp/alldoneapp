import { buildContactsViewData } from './contactsViewData'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from './Utils/ContactsHelper'

jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getTypeOfProject: jest.fn() },
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectsSettings', () => ({ PROJECT_TYPE_GUIDE: 'guide' }))
jest.mock('./Utils/ContactsHelper', () => ({
    __esModule: true,
    default: { isPrivateContact: jest.fn(contact => contact.isPrivate) },
}))

const projects = [{ id: 'project-1' }, { id: 'project-2' }]
const baseData = {
    loggedUser: { uid: 'logged-user' },
    loggedUserProjects: projects,
    projectUsers: {
        'project-1': [{ uid: 'user-1' }, { uid: 'private-user', isPrivate: true }],
        'project-2': [{ uid: 'user-2' }],
    },
    projectContacts: {
        'project-1': [{ uid: 'contact-1' }],
        'project-2': [{ uid: 'contact-2' }],
    },
    followedPeopleByProject: {
        'project-1': { userIds: ['user-1'], contactIds: ['contact-1'] },
        'project-2': { userIds: [], contactIds: ['contact-2'] },
    },
    selectedTypeOfProject: 'normal',
    selectedProjectIndex: -1,
    inAllProjects: true,
}

describe('buildContactsViewData', () => {
    beforeEach(() => {
        ProjectHelper.getTypeOfProject.mockReturnValue('normal')
        ContactsHelper.isPrivateContact.mockImplementation(contact => contact.isPrivate)
    })

    it('filters the Followed tab and calculates visible totals in one pass', () => {
        const result = buildContactsViewData({ ...baseData, contactsActiveTab: 0 })

        expect(result.filteredProjectsUsers).toEqual({
            'project-1': [{ uid: 'user-1' }],
            'project-2': [],
        })
        expect(result.filteredProjectsContacts).toEqual(baseData.projectContacts)
        expect(result.amounts).toEqual({
            users: 2,
            contacts: 2,
            followedUsers: 1,
            followedContacts: 2,
        })
    })

    it('reuses Redux arrays on the All tab instead of cloning all contact data', () => {
        const result = buildContactsViewData({ ...baseData, contactsActiveTab: 1 })

        expect(result.filteredProjectsUsers['project-1']).toBe(baseData.projectUsers['project-1'])
        expect(result.filteredProjectsContacts['project-2']).toBe(baseData.projectContacts['project-2'])
    })
})
