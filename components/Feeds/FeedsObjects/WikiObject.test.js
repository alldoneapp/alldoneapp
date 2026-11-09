import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            activeModalInFeed: false,
            isMiddleScreen: false,
            currentUser: { uid: 'u1' },
        }),
}))
jest.mock('../../../utils/backends/Feeds/wikiDayFeeds', () => ({ watchWikiDayFeeds: jest.fn() }))
jest.mock('../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore', () => ({
    getKnowledgeRevisionTitle: jest.fn(),
    getKnowledgeRunsStartedBefore: jest.fn(),
}))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: (projectId, userId) =>
        userId === 'u2' ? { shortName: 'Maria', photoURL: 'maria.png' } : { shortName: '', photoURL: '' },
}))
jest.mock('../../WikiView/wikiLinks', () => ({
    openProjectWiki: jest.fn(),
    openProjectWikiChange: jest.fn(),
    openProjectWikiSettings: jest.fn(),
}))
jest.mock('../Commons/FeedsTypesLeftHeader', () => {
    const { Text: MockText } = require('react-native')
    return ({ icon }) => <MockText testID="left-header">{icon || 'avatar'}</MockText>
})
jest.mock('../../Icon', () => ({ __esModule: true, default: () => null }))
jest.mock('../../../i18n/TranslationService', () => {
    const en = require('../../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
    }
})

import WikiObject from './WikiObject'
import { watchWikiDayFeeds } from '../../../utils/backends/Feeds/wikiDayFeeds'
import {
    getKnowledgeRevisionTitle,
    getKnowledgeRunsStartedBefore,
} from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { openProjectWiki, openProjectWikiChange, openProjectWikiSettings } from '../../WikiView/wikiLinks'
import { clearWikiFeedPageTitles, loadWikiFeedPageTitle } from '../FeedsTypes/useWikiFeedPageTitle'
import { clearWikiDayCosts } from './wikiDayCost'

const textOf = node => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    return node && node.children ? node.children.map(textOf).join('') : ''
}

const feed = (id, extra) => ({
    id,
    type: 'FEED_WIKI_PAGE_CHANGED',
    objectId: 'wiki',
    lastChangeDate: Date.UTC(2026, 9, 24, 8),
    isPublicFor: [0],
    ...extra,
})
const FEEDS = [
    feed('wiki_kunden_000002', {
        creatorId: 'u2',
        wikiSlug: 'kunden',
        wikiRevision: 2,
        wikiChange: 'corrected',
    }),
    feed('wiki_entscheidungen_000007', {
        creatorId: 'wiki',
        wikiSlug: 'entscheidungen',
        wikiRevision: 7,
        wikiChange: 'updated',
    }),
]

const mounted = []
async function mount(feeds = FEEDS) {
    let component
    await act(async () => {
        component = renderer.create(
            <WikiObject
                feedObjectData={{ object: { id: 'wiki', type: 'wiki' }, feeds }}
                projectId="p1"
                day="20261024"
                feedActiveTab={1}
            />
        )
    })
    mounted.push(component)
    return component
}

const expand = component =>
    act(async () => {
        component.root.findByProps({ testID: 'wiki-digest-toggle' }).props.onPress()
    })

beforeEach(() => {
    jest.clearAllMocks()
    clearWikiFeedPageTitles()
    clearWikiDayCosts()
    getKnowledgeRunsStartedBefore.mockResolvedValue([])
    watchWikiDayFeeds.mockImplementation((_project, _day, _user, _followed, onChange) => {
        onChange([], true)
        return () => {}
    })
    getKnowledgeRevisionTitle.mockImplementation(async (projectId, slug) => (slug === 'kunden' ? 'Kunden' : null))
})
afterEach(() => act(() => mounted.splice(0).forEach(component => component.unmount())))

describe('the wiki in the Updates feed', () => {
    it('summarizes unique pages across the full day, including revisions outside the feed window', async () => {
        const extra = [
            feed('wiki_kunden_000003', { wikiSlug: 'kunden', wikiRevision: 3, wikiChange: 'updated' }),
            feed('wiki_new_000001', { wikiSlug: 'new', wikiRevision: 1, wikiChange: 'created' }),
            feed('wiki_new_000002', { wikiSlug: 'new', wikiRevision: 2, wikiChange: 'updated' }),
            feed('wiki_old_000003', { wikiSlug: 'old', wikiRevision: 3, wikiChange: 'archived' }),
        ]
        watchWikiDayFeeds.mockImplementation((_project, _day, _user, _followed, onChange) => {
            onChange([...extra, ...FEEDS], true)
            return () => {}
        })

        const component = await mount([FEEDS[0]])

        expect(watchWikiDayFeeds).toHaveBeenCalledWith(
            'p1',
            '20261024',
            'u1',
            false,
            expect.any(Function),
            expect.any(Function)
        )
        expect(textOf(component.root.findByProps({ testID: 'wiki-digest-summary' }).children)).toBe(
            '1 new · 2 updated · 1 archived'
        )
        expect(textOf(component.root.findByProps({ testID: 'wiki-digest-page-kunden' }).children)).toContain(
            'Member edit'
        )
        expect(component.root.findAllByProps({ testID: 'wiki-feed-wiki_kunden_000002' })).toHaveLength(0)
        expect(getKnowledgeRevisionTitle).not.toHaveBeenCalledWith('p1', 'entscheidungen', 7)

        act(() => component.root.findByProps({ testID: 'wiki-digest-page-kunden' }).props.onPress())
        expect(openProjectWikiChange).toHaveBeenCalledWith('p1', 'kunden', 3)

        await expand(component)
        const rows = id =>
            component.root.findAll(node => typeof node.type === 'string' && node.props['data-testid'] === id)
        expect(rows('wiki-feed-wiki_kunden_000002')).toHaveLength(1)
        expect(rows('wiki-feed-wiki_old_000003')).toHaveLength(1)
    })

    it('refreshes the digest in place and labels cached or failed day reads as partial', async () => {
        const stop = jest.fn()
        watchWikiDayFeeds.mockReturnValue(stop)
        const component = await mount([FEEDS[0]])
        const [, , , , deliver, fail] = watchWikiDayFeeds.mock.calls[0]
        const summary = () => textOf(component.root.findByProps({ testID: 'wiki-digest-summary' }).children)

        expect(summary()).toBe('1 updated')
        await act(async () => deliver(FEEDS, false))
        expect(summary()).toBe('2 updated')
        expect(textOf(component.toJSON())).toContain('Showing available changes')
        await act(async () => deliver(FEEDS, true))
        expect(textOf(component.toJSON())).not.toContain('Showing available changes')
        await act(async () => fail())
        expect(summary()).toBe('1 updated')
        expect(textOf(component.toJSON())).toContain('Showing available changes')

        await act(async () => mounted.pop().unmount())
        expect(stop).toHaveBeenCalledTimes(1)
    })

    it('says who changed which page, with the title of that revision or its slug when none is left', async () => {
        const component = await mount()
        await expand(component)

        expect(textOf(component.root.findByProps({ testID: 'wiki-feed-wiki_kunden_000002' }).children)).toContain(
            'Maria corrected the page “Kunden” · Show changes'
        )
        expect(
            textOf(component.root.findByProps({ testID: 'wiki-feed-wiki_entscheidungen_000007' }).children)
        ).toContain('The wiki updated the page “entscheidungen”')
        expect(getKnowledgeRevisionTitle).toHaveBeenCalledWith('p1', 'kunden', 2)
    })

    it('shows the member who made a change, and a book for the wiki’s own updates', async () => {
        const component = await mount()
        await expand(component)

        expect(component.root.findAllByProps({ testID: 'left-header' }).map(node => textOf(node.children))).toEqual([
            'avatar',
            'book-open',
        ])
    })

    it('opens what that revision changed from its line, and the wiki from the header', async () => {
        const component = await mount()
        await expand(component)

        act(() => component.root.findByProps({ testID: 'wiki-feed-wiki_kunden_000002' }).props.onPress())
        expect(openProjectWikiChange).toHaveBeenCalledWith('p1', 'kunden', 2)

        act(() => component.root.findByProps({ testID: 'wiki-feed-header' }).props.onPress())
        expect(openProjectWiki).toHaveBeenCalledWith('p1')
    })

    it('renders nothing for an entry that does not point at a real page revision', async () => {
        const component = await mount([feed('broken', { wikiSlug: '../x', wikiRevision: 2 })])

        expect(component.root.findAllByProps({ testID: 'wiki-feed-broken' })).toHaveLength(0)
    })

    it('says what the wiki cost that day, and links to its settings (AT-2967)', async () => {
        getKnowledgeRunsStartedBefore.mockResolvedValue([
            { id: 'later', startedAt: Date.UTC(2026, 9, 24, 14), status: 'running', goldSpent: 99 },
            {
                id: 'night',
                startedAt: Date.UTC(2026, 9, 24, 2),
                finishedAt: Date.UTC(2026, 9, 24, 2, 9),
                goldSpent: 12,
            },
            {
                id: 'before',
                startedAt: Date.UTC(2026, 9, 23, 2),
                finishedAt: Date.UTC(2026, 9, 23, 2, 5),
                goldSpent: 40,
            },
        ])

        const component = await mount()

        expect(getKnowledgeRunsStartedBefore).toHaveBeenCalledWith('p1', Date.UTC(2026, 9, 25))
        expect(textOf(component.root.findByProps({ testID: 'wiki-digest-cost' }).children)).toBe(
            'Cost this day: 12 Gold · a run is still going · Wiki settings'
        )
        act(() => component.root.findByProps({ testID: 'wiki-digest-settings' }).props.onPress())
        expect(openProjectWikiSettings).toHaveBeenCalledWith('p1')
    })

    it('leaves the cost out when the runs cannot be read', async () => {
        getKnowledgeRunsStartedBefore.mockRejectedValue(new Error('offline'))

        const component = await mount()

        expect(component.root.findAllByProps({ testID: 'wiki-digest-cost' })).toHaveLength(0)
        expect(component.root.findByProps({ testID: 'wiki-digest-summary' })).toBeDefined()
    })

    it('reads a revision title once for every line and tab that shows it', async () => {
        await Promise.all([
            loadWikiFeedPageTitle('p1', 'kunden', 2),
            loadWikiFeedPageTitle('p1', 'kunden', 2),
            loadWikiFeedPageTitle('p1', 'kunden', 3),
        ])

        expect(getKnowledgeRevisionTitle).toHaveBeenCalledTimes(2)
    })
})

describe('a source a member handed the wiki (MCP feed parity)', () => {
    const sourceFeed = (id, extra) => ({
        id,
        type: 'FEED_WIKI_SOURCE_CHANGED',
        objectId: 'wiki',
        creatorId: 'u2',
        lastChangeDate: Date.UTC(2026, 9, 24, 9),
        isPublicFor: [0],
        entryText: 'added a document to the wiki',
        wikiSourceChange: 'document_added',
        ...extra,
    })

    it('shows the line by itself when no page changed yet, and opens the wiki from it', async () => {
        const component = await mount([sourceFeed('wikisource_document_added_d1', { via: 'mcp', viaClient: 'Claude' })])

        const line = component.root.findByProps({ testID: 'wiki-source-feed-wikisource_document_added_d1' })
        expect(textOf(line.children)).toContain('Maria (via Claude) added a document to the wiki')
        expect(component.root.findAllByProps({ testID: 'wiki-digest-summary' })).toHaveLength(0)
        expect(component.root.findAllByProps({ testID: 'wiki-digest-toggle' })).toHaveLength(0)

        act(() => line.props.onPress())
        expect(openProjectWiki).toHaveBeenCalledWith('p1')
    })

    it('lists source lines next to the page digest without counting them as pages', async () => {
        const component = await mount([
            ...FEEDS,
            sourceFeed('wikisource_contribution_removed_c1', {
                creatorId: 'u1',
                wikiSourceChange: 'contribution_removed',
            }),
        ])

        expect(textOf(component.root.findByProps({ testID: 'wiki-digest-summary' }).children)).toBe('2 updated')
        expect(
            textOf(
                component.root.findByProps({ testID: 'wiki-source-feed-wikisource_contribution_removed_c1' }).children
            )
        ).toContain('A project member removed saved knowledge from the wiki')
    })

    it('renders nothing for a source line of a kind it does not know', async () => {
        const component = await mount([sourceFeed('odd', { wikiSourceChange: 'document_renamed' })])
        expect(component.toJSON()).toBeNull()
    })
})
