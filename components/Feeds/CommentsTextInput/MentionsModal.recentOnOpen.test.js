/**
 * @jest-environment jsdom
 *
 * AT-2497 — "when I at-mention in a note and then go to the notes tab I should see the most
 * recent notes by default".
 *
 * The @-mention popup opens with `mentionText` empty (the "@" has been typed, nothing after
 * it yet) and runs one search per tab straight away. Typesense has no empty query: `q: ''`
 * tokenizes to nothing and matches nothing, so every tab rendered the EmptyMatch copy
 * ("There are not results to show in this tab") until the user typed a letter. The tab that
 * suffers most is Notes, whose whole purpose is to link a note you were just working on.
 *
 * The pin is on the REQUEST, not on rendered rows: what was wrong is what the modal asked
 * the engine for. `utils/typesenseSearch.test.js` pins the other half — that
 * `matchAllWhenEmpty` turns into the `*` wildcard ordered by recency rather than by a text
 * score every document ties on.
 */
import React from 'react'
import { Platform } from 'react-native'
import renderer, { act } from 'react-test-renderer'

Platform.OS = 'web'

const CURRENT_PROJECT_ID = 'project-current'

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

// The notes tab renders through MentionsItemsGrouped; capture what the modal hands it, which
// is exactly the list the user sees under the "Notes" tab.
const mockRenderedItems = { current: [] }
jest.mock('./MentionsModal/MentionsItemsGrouped', () => ({
    __esModule: true,
    default: props => {
        mockRenderedItems.current = props.items
        return null
    },
}))

const MentionsModal = require('./MentionsModal').default
const {
    NOTES_INDEX_NAME_PREFIX,
    TASKS_INDEX_NAME_PREFIX,
    GOALS_INDEX_NAME_PREFIX,
    CONTACTS_INDEX_NAME_PREFIX,
    CHATS_INDEX_NAME_PREFIX,
} = require('../../GlobalSearchAlgolia/searchHelper')

const note = (id, title) => ({ id, title, projectId: CURRENT_PROJECT_ID, objectID: id + CURRENT_PROJECT_ID })

const renderAndSearch = async (mentionText = '') => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <MentionsModal
                mentionText={mentionText}
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

const callFor = indexPrefix => mockSearchTypesenseCollection.mock.calls.find(call => call[0] === indexPrefix)

describe('MentionsModal suggests recent items before anything is typed (AT-2497)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockRenderedItems.current = []
        mockSearchTypesenseCollection.mockReset()
        mockSearchTypesenseCollection.mockResolvedValue({ hits: [] })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('asks the notes tab to match all when the mention text is still empty', async () => {
        await renderAndSearch('')

        const notesCall = callFor(NOTES_INDEX_NAME_PREFIX)
        expect(notesCall[1]).toBe('')
        expect(notesCall[3].matchAllWhenEmpty).toBe(true)
    })

    it('does the same for every other tab, so none of them opens blank', async () => {
        await renderAndSearch('')

        // A popup where one tab suggests something and four say "no results" reads as four
        // broken tabs rather than as one helpful one.
        ;[
            TASKS_INDEX_NAME_PREFIX,
            GOALS_INDEX_NAME_PREFIX,
            CONTACTS_INDEX_NAME_PREFIX,
            CHATS_INDEX_NAME_PREFIX,
        ].forEach(indexPrefix => {
            expect(callFor(indexPrefix)[3].matchAllWhenEmpty).toBe(true)
        })
    })

    it('keeps the AT-2393 contact field narrowing while doing it', async () => {
        await renderAndSearch('')

        // The two options travel in the same bag now — the earlier fix must not be lost to it.
        expect(callFor(CONTACTS_INDEX_NAME_PREFIX)[3]).toEqual({
            queryBy: 'displayName,role,company',
            matchAllWhenEmpty: true,
        })
    })

    it('still sends the typed text once the user types, and lets relevance rank it', async () => {
        await renderAndSearch('roadmap')

        const notesCall = callFor(NOTES_INDEX_NAME_PREFIX)
        expect(notesCall[1]).toBe('roadmap')
        // matchAllWhenEmpty is inert for a non-blank query - the flag stays on, the search
        // layer is what decides, and it only substitutes the wildcard for a blank query.
        expect(notesCall[3].matchAllWhenEmpty).toBe(true)
    })

    it('renders the returned notes in the order the engine ranked them', async () => {
        // The engine returns most-recently-edited first; the modal only re-groups by project
        // (a stable sort), so the recency order has to survive into the rendered list.
        mockSearchTypesenseCollection.mockImplementation(async indexPrefix => {
            if (indexPrefix !== NOTES_INDEX_NAME_PREFIX) return { hits: [] }
            return {
                hits: [note('n1', 'Edited today'), note('n2', 'Edited yesterday'), note('n3', 'Edited last week')],
            }
        })

        const tree = await renderAndSearch('')
        await act(async () => {
            tree.root.findByProps({ text: 'Notes' }).props.onPress()
        })

        expect(mockRenderedItems.current.map(item => item.title)).toEqual([
            'Edited today',
            'Edited yesterday',
            'Edited last week',
        ])
    })

    it('counts the prefilled notes in the tab badge, so the tab does not look empty', async () => {
        mockSearchTypesenseCollection.mockImplementation(async indexPrefix => {
            if (indexPrefix !== NOTES_INDEX_NAME_PREFIX) return { hits: [] }
            return { hits: [note('n1', 'One'), note('n2', 'Two')] }
        })

        const tree = await renderAndSearch('')

        expect(tree.root.findByProps({ text: 'Notes' }).props.badgeValue).toBe(2)
    })
})
