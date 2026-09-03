/**
 * @jest-environment jsdom
 *
 * AT-2497 — "when I at-mention in a note and then go to the notes tab I should see the most
 * recent notes by default".
 *
 * The engine side of this was never broken. `dev_notes` is configured
 * `sort_by: '_text_match:desc,lastEditionDate(missing_values: last):desc'` and returns the
 * user's most recently edited notes first — verified against a real Typesense server, for a
 * blank query as well as for the `*` wildcard. What threw that away was HERE: the grouped
 * renderer regrouped the page by project and ordered the groups by their sidebar `index`,
 * so the single most recently edited note rendered several rows down, under a project
 * header, purely because its project sat third in the sidebar.
 *
 * The contract this pins is one line: this component GROUPS, it does not REORDER. The order
 * of the list handed to it is the order the user reads.
 *
 * It drives the REAL MentionsItems inside the REAL MentionsItemsGrouped, because "which
 * project block comes first" is not observable from the props of a mocked child — the
 * previous AT-2497 suite mocked this component out entirely, which is exactly why it passed
 * while production stayed wrong.
 */
import React from 'react'
import { Platform } from 'react-native'
import renderer from 'react-test-renderer'

Platform.OS = 'web'

const CURRENT = 'p-current'
const OTHER_EARLY = 'p-early-in-sidebar'
const OTHER_LATE = 'p-late-in-sidebar'

const mockStoreState = {
    loggedUser: { uid: 'me' },
    loggedUserProjectsMap: {
        // Deliberately the reverse of the recency order below: the project holding the most
        // recent note is LAST in the sidebar. That is the shape the bug needed.
        [CURRENT]: { id: CURRENT, name: 'Current', index: 0 },
        [OTHER_EARLY]: { id: OTHER_EARLY, name: 'Early', index: 1 },
        [OTHER_LATE]: { id: OTHER_LATE, name: 'Late', index: 2 },
    },
    projectContacts: {},
}

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector => selector(mockStoreState),
}))

jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getPeopleById: () => null },
}))

jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: () => null,
    isGlobalAssistant: () => false,
    GLOBAL_PROJECT_ID: 'globalProject',
}))

// The row's visible label. Rendering the real parser here would only add a text-splitting
// pipeline between the assertion and the thing under test.
jest.mock('../../TextParser/ObjectHeaderParser', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return { __esModule: true, default: ({ text }) => React.createElement(Text, null, String(text)) }
})

const MentionsItemsGrouped = require('./MentionsItemsGrouped').default
const { MENTION_MODAL_NOTES_TAB } = require('../textInputHelper')

const note = (title, projectId) => ({
    id: `${title}-${projectId}`,
    objectID: `${title}${projectId}`,
    title,
    extendedTitle: title,
    projectId,
    userId: 'me',
})

const renderGrouped = items =>
    renderer.create(
        <MentionsItemsGrouped
            currentProjectId={CURRENT}
            items={items}
            selectItemToMention={() => {}}
            activeItemIndex={-1}
            itemsComponentsRefs={{ current: {} }}
            activeTab={MENTION_MODAL_NOTES_TAB}
        />
    )

// Every string leaf, in render order: note titles and project header names alike, which is
// literally what the user reads down the popup.
const renderedText = tree => {
    const out = []
    const walk = node => {
        if (node == null) return
        if (typeof node === 'string') return out.push(node)
        if (Array.isArray(node)) return node.forEach(walk)
        if (node.children) node.children.forEach(walk)
    }
    walk(tree.toJSON())
    return out
}

const renderedNotes = (tree, titles) => renderedText(tree).filter(text => titles.includes(text))

describe('AT-2497 — the notes list is rendered in the order it was given', () => {
    it('does not push the most recent note below projects that sort earlier in the sidebar', () => {
        // Recency order as the engine returned it. `newest` belongs to the project that is
        // LAST in the sidebar, `third` to the one that is second.
        const items = [
            note('newest', OTHER_LATE),
            note('second', CURRENT),
            note('third', OTHER_EARLY),
            note('fourth', OTHER_LATE),
        ]

        const rendered = renderedNotes(renderGrouped(items), ['newest', 'second', 'third', 'fourth'])

        // The current project still leads — that is deliberate and unchanged; it is the
        // project you are writing in. What changed is everything after it: before the fix
        // this was ['second', 'third', 'newest', 'fourth'], with the newest note demoted
        // below an older one purely because `index` beat recency.
        expect(rendered).toEqual(['second', 'newest', 'fourth', 'third'])
        expect(rendered.indexOf('newest')).toBeLessThan(rendered.indexOf('third'))
    })

    it('keeps the current project at the top when it leads the list', () => {
        // The modal puts the current project first (mergeMentionPages), and the renderer
        // must not undo that either.
        const items = [note('mine-newest', CURRENT), note('mine-older', CURRENT), note('theirs', OTHER_LATE)]

        expect(renderedNotes(renderGrouped(items), ['mine-newest', 'mine-older', 'theirs'])).toEqual([
            'mine-newest',
            'mine-older',
            'theirs',
        ])
    })

    it('orders the other-project headers by first appearance, not by sidebar index', () => {
        const items = [note('a', OTHER_LATE), note('b', OTHER_EARLY)]

        const text = renderedText(renderGrouped(items))
        expect(text.indexOf('Late')).toBeLessThan(text.indexOf('Early'))
    })

    it('still groups: each project keeps one header and its own rows', () => {
        const items = [note('a', OTHER_LATE), note('b', CURRENT), note('c', OTHER_LATE)]

        const text = renderedText(renderGrouped(items))
        // The current project is rendered without a header (it is where you already are).
        expect(text.filter(entry => entry === 'Late')).toHaveLength(1)
        expect(text).not.toContain('Current')
        // and its two notes stay together under it rather than being split by the regroup
        // (the current project's own row leads, as always).
        expect(renderedNotes(renderGrouped(items), ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
    })

    it('drops items whose project the user cannot see, without disturbing the rest', () => {
        const items = [note('visible', OTHER_LATE), note('hidden', 'p-not-in-map'), note('also-visible', CURRENT)]

        expect(renderedNotes(renderGrouped(items), ['visible', 'hidden', 'also-visible'])).toEqual([
            'also-visible',
            'visible',
        ])
    })
})
