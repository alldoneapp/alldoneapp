import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ activeModalInFeed: false, isMiddleScreen: false }),
}))
jest.mock('../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore', () => ({
    getKnowledgeRevisionTitle: jest.fn(),
}))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: (projectId, userId) =>
        userId === 'u2' ? { shortName: 'Maria', photoURL: 'maria.png' } : { shortName: '', photoURL: '' },
}))
jest.mock('../../WikiView/wikiLinks', () => ({ openProjectWiki: jest.fn(), openProjectWikiChange: jest.fn() }))
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
import { getKnowledgeRevisionTitle } from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { openProjectWiki, openProjectWikiChange } from '../../WikiView/wikiLinks'
import { clearWikiFeedPageTitles, loadWikiFeedPageTitle } from '../FeedsTypes/useWikiFeedPageTitle'

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
                feedActiveTab={1}
            />
        )
    })
    mounted.push(component)
    return component
}

beforeEach(() => {
    jest.clearAllMocks()
    clearWikiFeedPageTitles()
    getKnowledgeRevisionTitle.mockImplementation(async (projectId, slug) => (slug === 'kunden' ? 'Kunden' : null))
})
afterEach(() => act(() => mounted.splice(0).forEach(component => component.unmount())))

describe('the wiki in the Updates feed', () => {
    it('says who changed which page, with the title of that revision or its slug when none is left', async () => {
        const component = await mount()

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

        expect(component.root.findAllByProps({ testID: 'left-header' }).map(node => textOf(node.children))).toEqual([
            'avatar',
            'book-open',
        ])
    })

    it('opens what that revision changed from its line, and the wiki from the header', async () => {
        const component = await mount()

        act(() => component.root.findByProps({ testID: 'wiki-feed-wiki_kunden_000002' }).props.onPress())
        expect(openProjectWikiChange).toHaveBeenCalledWith('p1', 'kunden', 2)

        act(() => component.root.findByProps({ testID: 'wiki-feed-header' }).props.onPress())
        expect(openProjectWiki).toHaveBeenCalledWith('p1')
    })

    it('renders nothing for an entry that does not point at a real page revision', async () => {
        const component = await mount([feed('broken', { wikiSlug: '../x', wikiRevision: 2 })])

        expect(component.root.findAllByProps({ testID: 'wiki-feed-broken' })).toHaveLength(0)
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
