/**
 * @jest-environment jsdom
 *
 * AT-2497, end to end — "when I at-mention in a note and then go to the notes tab I should
 * see the most recent notes by default".
 *
 * This is the suite that would have caught the first attempt at this ticket. That fix
 * (MR !495) changed the notes query from `q: ''` to `q: '*'` on the belief that Typesense
 * "matches nothing" for a blank query and the tab was therefore empty. Driven against a real
 * Typesense server, both forms return the same page in the same order, so it changed nothing
 * the user could see. The two things that were actually wrong were both downstream of the
 * engine, and both are invisible to a test that mocks the list renderer or uses a single
 * project:
 *
 *   1. one shared page of `per_page` notes is drawn from EVERY project the user belongs to,
 *      so the project being written in routinely contributes nothing to it at all; and
 *   2. the grouped renderer re-sorted that recency-ordered page by sidebar position.
 *
 * So this drives the REAL search layer (mocked only at `fetch`, with a stand-in engine that
 * honours filter_by/sort_by/per_page the way Typesense does), the REAL modal and the REAL
 * grouped list, and asserts on the order of the rows a user reads.
 */
import React from 'react'
import { Platform } from 'react-native'
import renderer, { act } from 'react-test-renderer'

Platform.OS = 'web'

const CURRENT = 'p-current'
const BUSY = 'p-busy'
const QUIET = 'p-quiet'
const UID = 'me'

jest.mock('../../../utils/backends/Assistants/assistantsFirestore', () => ({
    getPreConfigTasksForProject: async () => [],
}))

jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        getId: () => 'mention-modal-id',
        getCurrentUserId: () => 'me',
        getTypesenseScopedSearchCredentials: async () => ({
            userId: 'me',
            origin: 'https://typesense.test',
            apiKey: 'scoped-key',
            expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
    },
}))

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getProjectById: () => ({ parentTemplateId: null, userIds: [] }),
        getUserRoleInProject: () => '',
        getUserCompanyInProject: () => '',
        getUserDescriptionInProject: () => '',
    },
}))

jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: () => null,
    isGlobalAssistant: () => false,
    GLOBAL_PROJECT_ID: 'globalProject',
}))

jest.mock('../TextParser/ObjectHeaderParser', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return { __esModule: true, default: ({ text }) => React.createElement(Text, null, String(text)) }
})

const mockStoreState = {
    loggedUser: { uid: UID },
    loggedUserProjectsMap: {
        [CURRENT]: { id: CURRENT, name: 'Current', index: 0 },
        // Deliberately the opposite of the recency order: the project holding the newest
        // notes sits LAST in the sidebar. That disagreement is what the old renderer
        // resolved the wrong way round.
        [QUIET]: { id: QUIET, name: 'Quiet', index: 1 },
        [BUSY]: { id: BUSY, name: 'Busy', index: 2 },
    },
    loggedUserProjects: [],
    projectUsers: {},
    projectContacts: { [CURRENT]: [], [BUSY]: [], [QUIET]: [] },
    mentionModalStack: [],
    smallScreenNavigation: false,
    connectionState: '',
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

const MentionsModal = require('./MentionsModal').default
const { __resetTypesenseCredentialCacheForTests } = require('../../../utils/typesenseSearch')

// The production shape, from the reporting account on 2026-09-03: one project is edited all
// day, the project being written in was last touched two weeks ago, and a single 20-row page
// is shared between them. The real top-20 there contains ZERO notes from the current project.
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 3, 10, 0)
const NOTES = [
    ...Array.from({ length: 24 }, (_, i) => ({
        title: `busy ${String(i).padStart(2, '0')}`,
        projectId: BUSY,
        lastEditionDate: NOW - i * 3600000,
    })),
    // Interleaved with the busy project's day, exactly as Privat/Familie/Alldone Business
    // sit inside the reporting account's real top twenty.
    { title: 'quiet recent', projectId: QUIET, lastEditionDate: NOW - 4.5 * 3600000 },
    ...Array.from({ length: 4 }, (_, i) => ({
        title: `mine ${String(i).padStart(2, '0')}`,
        projectId: CURRENT,
        lastEditionDate: NOW - (14 + i) * DAY,
    })),
].map(entry => ({
    ...entry,
    id: `${entry.title}${entry.projectId}`,
    extendedTitle: entry.title,
    userId: UID,
    isPublicFor: ['0', UID],
}))

const ALL_TITLES = NOTES.map(entry => entry.title)

// A stand-in for the engine: honours the project scope in `filter_by`, the recency
// `sort_by`, and `per_page`. Verified against a real Typesense 29 server for this query
// shape, including that a blank `q` and `*` both return the full filtered set.
const requestedProjectIds = filterBy => {
    const scope = /projectId:=(\[[^\]]*\]|`[^`]*`)/.exec(filterBy || '')
    if (!scope) return null
    return [...scope[1].matchAll(/`([^`]*)`/g)].map(match => match[1])
}

const seenSearches = []

const fakeTypesense = async (url, init) => {
    const { searches } = JSON.parse(init.body)
    const results = searches.map(search => {
        seenSearches.push(search)
        if (search.collection !== 'dev_notes') return { hits: [] }
        const allowed = requestedProjectIds(search.filter_by)
        const matched = NOTES.filter(entry => !allowed || allowed.includes(entry.projectId))
            .slice()
            .sort((a, b) => b.lastEditionDate - a.lastEditionDate)
            .slice(0, search.per_page)
        return { hits: matched.map(document => ({ document: { ...document, id: `${document.id}` } })) }
    })
    return { ok: true, status: 200, json: async () => ({ results }) }
}

const openNotesTab = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <MentionsModal
                mentionText=""
                projectId={CURRENT}
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
    await act(async () => {
        tree.root.findByProps({ text: 'Notes' }).props.onPress()
    })
    return tree
}

const renderedNoteTitles = tree => {
    const out = []
    const walk = node => {
        if (node == null) return
        if (typeof node === 'string') {
            if (ALL_TITLES.includes(node)) out.push(node)
            return
        }
        if (Array.isArray(node)) return node.forEach(walk)
        if (node.children) node.children.forEach(walk)
    }
    walk(tree.toJSON())
    return out
}

describe('AT-2497 — the Notes tab opens on your most recent notes', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        seenSearches.length = 0
        __resetTypesenseCredentialCacheForTests()
        global.fetch = jest.fn(fakeTypesense)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('shows the current project even though a busier project fills the shared page', async () => {
        const rendered = renderedNoteTitles(await openNotesTab())

        // The reported symptom: nothing from the project you are writing in.
        expect(rendered.filter(title => title.startsWith('mine'))).not.toHaveLength(0)
        expect(rendered.slice(0, 4)).toEqual(['mine 00', 'mine 01', 'mine 02', 'mine 03'])
    })

    it('still offers the notes you edited most recently, newest first', async () => {
        const rendered = renderedNoteTitles(await openNotesTab())

        const busy = rendered.filter(title => title.startsWith('busy'))
        expect(busy.slice(0, 3)).toEqual(['busy 00', 'busy 01', 'busy 02'])
        // ...and the busy project, which holds the newest notes of all, is listed before the
        // quiet one even though the sidebar orders them the other way round.
        expect(rendered.indexOf('busy 00')).toBeLessThan(rendered.indexOf('quiet recent'))
    })

    it('never repeats a note, though both pages legitimately return it', async () => {
        const rendered = renderedNoteTitles(await openNotesTab())

        expect(new Set(rendered).size).toBe(rendered.length)
    })

    it('asks the engine for the documented match-all, ordered by recency alone', async () => {
        await openNotesTab()

        const noteSearches = seenSearches.filter(search => search.collection === 'dev_notes')
        expect(noteSearches).toHaveLength(2)
        noteSearches.forEach(search => {
            expect(search.q).toBe('*')
            // `_text_match` ties across every document of a match-all page, so leading with
            // it would leave the real order to the engine.
            expect(search.sort_by).toBe('lastEditionDate(missing_values: last):desc')
        })
    })

    it('keeps the privacy scope on both pages', async () => {
        await openNotesTab()

        // The current-project page narrows reach; it must never widen it.
        seenSearches
            .filter(search => search.collection === 'dev_notes')
            .forEach(search => expect(search.filter_by).toContain('isPublicFor:=[`0`,`me`]'))
    })
})
