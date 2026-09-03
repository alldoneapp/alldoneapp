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
const mockMultiSearchTypesense = jest.fn()

jest.mock('../../../utils/typesenseSearch', () => ({
    searchTypesenseCollection: (...args) => mockSearchTypesenseCollection(...args),
    multiSearchTypesense: (...args) => mockMultiSearchTypesense(...args),
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

const OTHER_PROJECT_ID = 'project-other'

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

const note = (id, title, projectId = CURRENT_PROJECT_ID) => ({
    id,
    title,
    projectId,
    objectID: id + projectId,
})

// Notes are fetched as two pages in one round trip (AT-2497), so they no longer come
// through searchTypesenseCollection at all.
const notesSearches = () => (mockMultiSearchTypesense.mock.calls[0] || [[]])[0]
const notesSearchFor = predicate => notesSearches().find(predicate)

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
        mockMultiSearchTypesense.mockReset()
        mockMultiSearchTypesense.mockImplementation(async searches => searches.map(() => ({ hits: [] })))
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('asks the notes tab to match all when the mention text is still empty', async () => {
        await renderAndSearch('')

        expect(notesSearches()).toHaveLength(2)
        notesSearches().forEach(search => {
            expect(search.collection).toBe(NOTES_INDEX_NAME_PREFIX)
            expect(search.query).toBe('')
            expect(search.matchAllWhenEmpty).toBe(true)
        })
    })

    it('fetches the current project as its own page beside the cross-project one', async () => {
        // AT-2497: one shared page is drawn from every project the user belongs to, so the
        // project being written in can contribute nothing at all. Measured in production:
        // the twenty most recently edited notes on the reporting account contain zero from
        // the project this ticket lives in.
        await renderAndSearch('')

        const currentProjectSearch = notesSearchFor(search => !search.filterBy.includes(OTHER_PROJECT_ID))
        const crossProjectSearch = notesSearchFor(search => search.filterBy.includes(OTHER_PROJECT_ID))

        expect(currentProjectSearch.filterBy).toContain(`projectId:=\`${CURRENT_PROJECT_ID}\``)
        expect(crossProjectSearch.filterBy).toContain(CURRENT_PROJECT_ID)

        // Both are ANDed with the same privacy scope: this narrows reach, never widens it.
        notesSearches().forEach(search => {
            expect(search.filterBy).toContain('isPublicFor:=[`0`,`me`]')
        })
    })

    it('keeps the current project on the page when the cross-project page is full', async () => {
        mockMultiSearchTypesense.mockImplementation(async searches =>
            searches.map(search =>
                search.filterBy.includes(OTHER_PROJECT_ID)
                    ? { hits: Array.from({ length: 20 }, (_, i) => note(`x${i}`, `Theirs ${i}`, OTHER_PROJECT_ID)) }
                    : { hits: [note('mine', 'Mine, edited two weeks ago')] }
            )
        )

        const tree = await renderAndSearch('')
        await act(async () => {
            tree.root.findByProps({ text: 'Notes' }).props.onPress()
        })

        expect(mockRenderedItems.current[0].title).toBe('Mine, edited two weeks ago')
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

        notesSearches().forEach(search => expect(search.query).toBe('roadmap'))
        // matchAllWhenEmpty is inert for a non-blank query - the flag stays on, the search
        // layer is what decides, and it only substitutes the wildcard for a blank query.
        notesSearches().forEach(search => expect(search.matchAllWhenEmpty).toBe(true))
    })

    it('renders the returned notes in the order the engine ranked them', async () => {
        // The engine returns most-recently-edited first; the modal only re-groups by project
        // (a stable sort), so the recency order has to survive into the rendered list.
        mockMultiSearchTypesense.mockImplementation(async searches =>
            searches.map(() => ({
                hits: [note('n1', 'Edited today'), note('n2', 'Edited yesterday'), note('n3', 'Edited last week')],
            }))
        )

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

    it('does not replace an empty tab with a spinner that never stops', async () => {
        // changeTab used to set the spinner unconditionally, and only a COMPLETING search
        // ever cleared it. Switching to a tab whose search had already finished and come
        // back empty therefore swapped the "no results" copy for a spinner that spun for
        // as long as the popup stayed open — which is what "I don't see my notes" looks
        // like when there is genuinely nothing to show.
        const EmptyMatch = require('./MentionsModal/EmptyMatch').default

        const tree = await renderAndSearch('')
        await act(async () => {
            tree.root.findByProps({ text: 'Notes' }).props.onPress()
        })

        expect(tree.root.findByType(EmptyMatch).props.showSpinner).toBe(false)
    })

    it('still shows the spinner while a search is actually running', async () => {
        // The guard must not turn into "never show a spinner": before the first pass
        // resolves there is nothing to render and a spinner is the honest answer.
        let releaseNotes
        mockMultiSearchTypesense.mockImplementation(
            () => new Promise(resolve => (releaseNotes = () => resolve([{ hits: [] }, { hits: [] }])))
        )
        mockSearchTypesenseCollection.mockReturnValue(new Promise(() => {}))
        const EmptyMatch = require('./MentionsModal/EmptyMatch').default

        const tree = await renderAndSearch('')
        await act(async () => {
            tree.root.findByProps({ text: 'Notes' }).props.onPress()
        })

        expect(tree.root.findByType(EmptyMatch).props.showSpinner).toBe(true)
        await act(async () => {
            releaseNotes()
        })
    })

    it('counts the prefilled notes in the tab badge, so the tab does not look empty', async () => {
        mockMultiSearchTypesense.mockImplementation(async searches =>
            searches.map(() => ({ hits: [note('n1', 'One'), note('n2', 'Two')] }))
        )

        const tree = await renderAndSearch('')

        expect(tree.root.findByProps({ text: 'Notes' }).props.badgeValue).toBe(2)
    })
})
