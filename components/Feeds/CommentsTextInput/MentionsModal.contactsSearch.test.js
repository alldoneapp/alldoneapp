/**
 * @jest-environment jsdom
 *
 * AT-2393 — end-to-end pin for the @-mention search that actually leaves the modal: it
 * must not look at the contact's free-text description, and it must ask only for the
 * projects whose hits the modal was going to keep. The unit tests next to
 * `MentionsModal/mentionSearch.js` pin the pieces; this pins the wiring, which is where
 * the defect lived (the modal passed no override and no project scope at all).
 */
import React from 'react'
import { Platform } from 'react-native'
import renderer, { act } from 'react-test-renderer'

Platform.OS = 'web'

const CURRENT_PROJECT_ID = 'project-current'
const OTHER_PROJECT_ID = 'project-other'

const mockSearchTypesenseCollection = jest.fn()

jest.mock('../../../utils/typesenseSearch', () => ({
    searchTypesenseCollection: (...args) => mockSearchTypesenseCollection(...args),
}))

jest.mock('../../../utils/backends/Assistants/assistantsFirestore', () => ({
    getPreConfigTasksForProject: async () => [],
}))

jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { getId: () => 'mention-modal-id' },
}))

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getProjectById: () => ({ parentTemplateId: null, userIds: [] }),
        getUserRoleInProject: (projectId, uid, role) => role || '',
        getUserCompanyInProject: (projectId, uid, company) => company || '',
        getUserDescriptionInProject: () => '',
    },
}))

const mockStoreState = {
    loggedUser: { uid: 'me' },
    loggedUserProjectsMap: {
        [CURRENT_PROJECT_ID]: { id: CURRENT_PROJECT_ID, name: 'Current', index: 0 },
        [OTHER_PROJECT_ID]: { id: OTHER_PROJECT_ID, name: 'Other', index: 1 },
    },
    loggedUserProjects: [],
    projectUsers: {},
    mentionModalStack: [],
    smallScreenNavigation: false,
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => mockStoreState, dispatch: () => {}, subscribe: () => () => {} },
}))

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useDispatch: () => () => {},
    useSelector: selector => selector(mockStoreState),
}))

jest.mock('../../MyPlatform', () => ({ isMobile: false }))

// The rows themselves are not what is under test — capture the list the modal hands to the
// contacts renderer, which is exactly what the user sees in the tab.
const mockRenderedContacts = { current: [] }
jest.mock('./MentionsModal/MentionsContactsGrouped', () => ({
    __esModule: true,
    default: props => {
        mockRenderedContacts.current = props.contacts
        return null
    },
}))

const MentionsModal = require('./MentionsModal').default
const { CONTACTS_INDEX_NAME_PREFIX, NOTES_INDEX_NAME_PREFIX } = require('../../GlobalSearchAlgolia/searchHelper')
const { GLOBAL_PROJECT_ID } = require('../../AdminPanel/Assistants/assistantsHelper')

const contact = (uid, displayName, projectId) => ({ uid, displayName, projectId, id: uid, objectID: uid + projectId })

const renderAndSearch = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <MentionsModal
                mentionText="an"
                projectId={CURRENT_PROJECT_ID}
                selectItemToMention={() => {}}
                keepFocus={() => {}}
                insertNormalMention={() => {}}
                contentLocation={{ top: 0 }}
            />
        )
    })
    // useTextChange debounces the search behind a 700ms interval.
    await act(async () => {
        jest.advanceTimersByTime(1000)
    })
    await act(async () => {})
    return tree
}

const contactsSearchCall = () =>
    mockSearchTypesenseCollection.mock.calls.find(call => call[0] === CONTACTS_INDEX_NAME_PREFIX)

describe('MentionsModal contacts search (AT-2393)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockSearchTypesenseCollection.mockReset()
        mockSearchTypesenseCollection.mockResolvedValue({ hits: [] })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('asks Typesense for identity fields only, so a long description cannot match', async () => {
        await renderAndSearch()

        const call = contactsSearchCall()
        expect(call).toBeDefined()
        expect(call[3].queryBy).toEqual('displayName,role,company')
        expect(call[3].queryBy).not.toContain('cleanDescription')
    })

    it('asks only for the active projects it was going to keep, plus global assistants', async () => {
        await renderAndSearch()

        // Without this the 100-hit page is drawn from every project the user has ever been
        // a member of — including guides, templates and archived ones — and the records
        // from them are fetched only to be discarded by the client-side filter.
        expect(contactsSearchCall()[2]).toContain(
            `projectId:=[\`${CURRENT_PROJECT_ID}\`,\`${OTHER_PROJECT_ID}\`,\`${GLOBAL_PROJECT_ID}\`]`
        )
    })

    it('scopes the notes tab the same way, without the assistants carve-out', async () => {
        await renderAndSearch()

        const notesCall = mockSearchTypesenseCollection.mock.calls.find(call => call[0] === NOTES_INDEX_NAME_PREFIX)
        expect(notesCall[2]).toContain(`projectId:=[\`${CURRENT_PROJECT_ID}\`,\`${OTHER_PROJECT_ID}\`]`)
        expect(notesCall[2]).not.toContain(GLOBAL_PROJECT_ID)
    })

    it('leaves the other tabs on their collection default searchable fields', async () => {
        await renderAndSearch()

        mockSearchTypesenseCollection.mock.calls
            .filter(call => call[0] !== CONTACTS_INDEX_NAME_PREFIX)
            .forEach(call => expect(call[3].queryBy).toBeUndefined())
    })

    it('keeps one row per project for a person shared across projects, current project first', async () => {
        // Deliberately NOT de-duplicated: a cross-project mention is selected per project
        // (the row's project decides whether the existing member is mentioned or the
        // contact is copied across), and the project header is what says which is which.
        mockSearchTypesenseCollection.mockImplementation(async indexPrefix => {
            if (indexPrefix !== CONTACTS_INDEX_NAME_PREFIX) return { hits: [] }
            return {
                hits: [
                    contact('me', 'Karsten Wysk', OTHER_PROJECT_ID),
                    contact('me', 'Karsten Wysk', CURRENT_PROJECT_ID),
                    contact('anna', 'Anna Somova', CURRENT_PROJECT_ID),
                ],
            }
        })

        await renderAndSearch()

        expect(mockRenderedContacts.current.map(item => [item.displayName, item.projectId])).toEqual([
            ['Karsten Wysk', CURRENT_PROJECT_ID],
            ['Anna Somova', CURRENT_PROJECT_ID],
            ['Karsten Wysk', OTHER_PROJECT_ID],
        ])
    })
})
