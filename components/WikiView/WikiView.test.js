import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: 'p1', index: 0, color: '#123456' }],
    smallScreenNavigation: false,
    isMiddleScreen: false,
}
const mockWatchers = { knowledgeBase: null, pages: null }

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))
jest.mock('../../utils/backends/KnowledgeBase/knowledgeBaseFirestore', () => ({
    watchKnowledgeBase: jest.fn((projectId, onChange) => {
        mockWatchers.knowledgeBase = onChange
        return () => {}
    }),
    watchKnowledgePages: jest.fn((projectId, onChange) => {
        mockWatchers.pages = onChange
        return () => {}
    }),
    watchKnowledgeRuns: jest.fn(() => () => {}),
    getKnowledgePageRevisions: jest.fn(),
    getKnowledgePageChange: jest.fn(),
    undoKnowledgeCorrection: jest.fn(),
}))
jest.mock('../TaskListView/ProjectSection', () => {
    const passThrough = ({ children }) => children
    return { __esModule: true, default: passThrough, ProjectSectionBody: passThrough }
})
jest.mock(
    '../TaskListView/Header/ProjectHeader',
    () =>
        ({ customRight }) =>
            customRight
)
jest.mock('../UIControls/Button', () => {
    const { Text: MockText, TouchableOpacity: MockTouchable } = require('react-native')
    return ({ title, onPress, accessibilityLabel }) => (
        <MockTouchable onPress={onPress} accessibilityLabel={accessibilityLabel}>
            <MockText>{title || ''}</MockText>
        </MockTouchable>
    )
})
jest.mock('../Icon', () => ({ __esModule: true, default: () => null, getIconGlyph: () => '' }))
jest.mock('../../URLSystem/Wiki/URLsWiki', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_PROJECT_WIKI: 'PROJECT_WIKI',
    URL_PROJECT_WIKI_PAGE: 'PROJECT_WIKI_PAGE',
    URL_PROJECT_WIKI_PAGE_CHANGE: 'PROJECT_WIKI_PAGE_CHANGE',
}))
jest.mock('./wikiLinks', () => ({ openProjectWikiSettings: jest.fn(), openWikiSource: jest.fn() }))
jest.mock('./WikiCorrectionForm', () => {
    const { Text: MockText } = require('react-native')
    return ({ page }) => <MockText testID="wiki-correction-form">{`correcting ${page.slug}`}</MockText>
})
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ checkIfSelectedProject: index => index >= 0 }))
jest.mock('../../redux/actions', () => ({ setNavigationRoute: route => ({ type: 'setNavigationRoute', route }) }))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../i18n/TranslationService', () => {
    const en = require('../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
        useTranslator: () => {},
    }
})

import URLsWiki from '../../URLSystem/Wiki/URLsWiki'
import {
    getKnowledgePageChange,
    getKnowledgePageRevisions,
    undoKnowledgeCorrection,
} from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import WikiView from './WikiView'
import { openProjectWikiSettings, openWikiSource } from './wikiLinks'
import { getWikiSelectedRevision, setWikiSelectedSlug } from './wikiNavigationState'

const page = (slug, title, extra = {}) => ({
    slug,
    title,
    summary: `${title} summary`,
    body: `About ${title}.`,
    revision: 3,
    sourceKeys: [],
    sourceLabels: {},
    updatedAt: Date.UTC(2026, 9, 20, 8),
    ...extra,
})
const PAGES = [
    page('entscheidungen', 'Entscheidungen'),
    page('kunden', 'Kunden', {
        body: 'Acme [[task:t1]].',
        sourceKeys: ['task:t1', 'correction:k1'],
        sourceLabels: { 'task:t1': 'Acme gewinnen' },
    }),
]

function textOf(node) {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (!node || !node.children) return ''
    return node.children.map(textOf).join('')
}

// Every tree is unmounted after its test: a mounted wiki keeps listening for page changes and
// would react to the next test's.
const mounted = []
function mount() {
    let component
    act(() => {
        component = renderer.create(<WikiView />)
    })
    mounted.push(component)
    return component
}

afterEach(() => {
    act(() => mounted.splice(0).forEach(component => component.unmount()))
})

function deliver({ knowledgeBase, pages, pendingRebuilds = 0 }) {
    act(() => {
        mockWatchers.knowledgeBase(knowledgeBase)
        mockWatchers.pages(pages, { pendingRebuilds })
    })
}

const press = (component, testID) => act(() => component.root.findByProps({ testID }).props.onPress())
const pressText = (component, text) => {
    const target = component.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(child => textOf(child.children) === text))
    act(() => target.props.onPress())
}

beforeEach(() => {
    jest.clearAllMocks()
    mockState.selectedProjectIndex = 0
    mockState.smallScreenNavigation = false
    setWikiSelectedSlug('p1', null)
})

describe('WikiView', () => {
    it('asks for a project in the all-projects view', () => {
        mockState.selectedProjectIndex = -1
        const component = mount()

        expect(component.root.findAllByProps({ testID: 'wiki-choose-project' })).not.toHaveLength(0)
    })

    it('waits for both the settings and the pages before deciding what to show', () => {
        const component = mount()
        expect(textOf(component.toJSON())).toContain('Loading wiki')

        act(() => mockWatchers.knowledgeBase(null))
        expect(textOf(component.toJSON())).toContain('Loading wiki')
    })

    it('offers to set the wiki up when the project has none', () => {
        const component = mount()
        deliver({ knowledgeBase: null, pages: [] })

        expect(component.root.findAllByProps({ testID: 'wiki-not-set-up' })).not.toHaveLength(0)
        pressText(component, 'Set up wiki')
        expect(openProjectWikiSettings).toHaveBeenCalledWith('p1')
    })

    it('says the wiki is being built when it is on but has no pages yet', () => {
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: [] })

        expect(component.root.findAllByProps({ testID: 'wiki-building' })).not.toHaveLength(0)
        expect(textOf(component.toJSON())).not.toContain('Set up wiki')
    })

    it.each([
        ['a wide screen', false],
        ['a phone', true],
    ])('shows the index on its own on %s, then a page in its place', (label, phone) => {
        mockState.smallScreenNavigation = phone
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        expect(component.root.findAllByProps({ testID: 'wiki-index' })).not.toHaveLength(0)
        expect(component.root.findAllByProps({ testID: 'wiki-page-entscheidungen' })).toHaveLength(0)
        expect(URLsWiki.push).toHaveBeenLastCalledWith('PROJECT_WIKI', null, 'p1')

        press(component, 'wiki-index-kunden')

        expect(component.root.findAllByProps({ testID: 'wiki-index' })).toHaveLength(0)
        expect(component.root.findAllByProps({ testID: 'wiki-page-kunden' })).not.toHaveLength(0)
        expect(URLsWiki.push).toHaveBeenLastCalledWith('PROJECT_WIKI_PAGE', null, 'p1', 'kunden', 'Kunden')

        pressText(component, 'All wiki pages')
        expect(component.root.findAllByProps({ testID: 'wiki-index' })).not.toHaveLength(0)
    })

    it('says for every page when it last changed, in the index and on the page', () => {
        const component = mount()
        deliver({
            knowledgeBase: { enabled: true, lastRunAt: Date.UTC(2026, 9, 25, 8) },
            pages: [PAGES[0], { ...PAGES[1], updatedAt: Date.UTC(2026, 9, 24, 8) }],
        })

        const updated = slug => textOf(component.root.findByProps({ testID: `wiki-index-updated-${slug}` }).children)
        expect(updated('entscheidungen')).toMatch(/^Last updated: 20\.10\.2026/)
        expect(updated('kunden')).toMatch(/^Last updated: 24\.10\.2026/)
        // The line above the index is about the wiki as a whole, and says so.
        expect(textOf(component.root.findByProps({ testID: 'wiki-status' }).children)).toMatch(
            /^Wiki last updated: 25\.10\.2026/
        )

        press(component, 'wiki-index-kunden')
        expect(textOf(component.root.findByProps({ testID: 'wiki-page-updated' }).children)).toMatch(
            /^Last updated: 24\.10\.2026/
        )
    })

    it('says above the index that the wiki stands still at its monthly Gold limit', () => {
        const month = new Date(Date.now()).toISOString().slice(0, 7)
        const component = mount()
        deliver({
            knowledgeBase: {
                enabled: true,
                monthlyGold: { month, spent: 506 },
                lastRunStopReason: 'monthly_cap',
                nextRunAt: Date.now() + 24 * 60 * 60 * 1000,
            },
            pages: PAGES,
        })

        expect(textOf(component.root.findByProps({ testID: 'wiki-status' }).children)).toContain(
            'Paused: the monthly Gold limit is reached.'
        )
    })

    it('puts the settings in the project line as an icon centred like the other header actions', () => {
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        const [settings] = component.root.findAll(
            node => node.props.accessibilityLabel === 'Wiki settings' && node.props.buttonStyle
        )
        // It used to be pushed 16px down, out of the 56px line.
        expect(settings.props.buttonStyle).toMatchObject({ alignSelf: 'center', height: 32 })
        expect(settings.props.buttonStyle).not.toHaveProperty('marginTop')
        expect(settings.props.noBorder).toBe(true)

        act(() => settings.props.onPress())
        expect(openProjectWikiSettings).toHaveBeenCalledWith('p1')
    })

    it('lists what a page is built from and opens a cited object', () => {
        setWikiSelectedSlug('p1', 'kunden')
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        const sources = component.root.findByProps({ testID: 'wiki-page-source-task:t1' })
        expect(textOf(sources.findByType(Text).children)).toBe('Acme gewinnen')
        expect(component.root.findByProps({ testID: 'wiki-page-source-correction:k1' }).props.disabled).toBe(true)

        act(() => sources.props.onPress())
        expect(openWikiSource).toHaveBeenCalledWith('p1', expect.objectContaining({ objectType: 'task', id: 't1' }))
    })

    it('tells people that pages are hidden until they are rebuilt and that a paused wiki stays readable', () => {
        const component = mount()
        deliver({ knowledgeBase: { enabled: false }, pages: PAGES, pendingRebuilds: 2 })

        const status = textOf(component.root.findByProps({ testID: 'wiki-status' }).children)
        expect(status).toContain('2 pages are hidden until they are rebuilt')
        expect(status).toContain('It stays readable but is no longer updated')
    })

    it('loads the history on demand and says when a revision lost its text', async () => {
        getKnowledgePageRevisions.mockResolvedValue([
            { id: '000003', revision: 3, createdAt: Date.UTC(2026, 9, 20, 8), reason: 'Neuer Kunde' },
            { id: '000002', revision: 2, createdAt: Date.UTC(2026, 9, 19, 8), redacted: true },
        ])
        setWikiSelectedSlug('p1', 'entscheidungen')
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })
        expect(getKnowledgePageRevisions).not.toHaveBeenCalled()

        await act(async () => {
            pressText(component, 'Show history')
        })

        expect(getKnowledgePageRevisions).toHaveBeenCalledWith('p1', 'entscheidungen')
        const history = textOf(component.root.findByProps({ testID: 'wiki-history' }).children)
        expect(history).toContain('Neuer Kunde')
        expect(history).toContain('Text removed: a source it used became private or was deleted')
    })
    it('opens the feedback form for the page on display from the top of the page', () => {
        setWikiSelectedSlug('p1', 'entscheidungen')
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        pressText(component, 'Give feedback')

        expect(textOf(component.root.findByProps({ testID: 'wiki-correction-form' }).children)).toBe(
            'correcting entscheidungen'
        )
        expect(textOf(component.toJSON())).not.toContain('Give feedback')
    })

    it('offers to undo a correction only while it is the page’s latest revision', async () => {
        getKnowledgePageRevisions.mockResolvedValue([
            {
                id: '000003',
                revision: 3,
                mode: 'correction',
                reason: 'Frau Brandt, nicht Frau Berg.',
                author: { type: 'user', name: 'Karsten', correctionId: 'k1' },
            },
            {
                id: '000002',
                revision: 2,
                mode: 'correction',
                reason: 'Älter.',
                author: { type: 'user', name: 'Ulla', correctionId: 'k0' },
            },
        ])
        undoKnowledgeCorrection.mockResolvedValue({ success: true })
        setWikiSelectedSlug('p1', 'entscheidungen')
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        await act(async () => {
            pressText(component, 'Show history')
        })

        expect(textOf(component.root.findByProps({ testID: 'wiki-history' }).children)).toContain(
            'Correction by Karsten: Frau Brandt, nicht Frau Berg.'
        )
        expect(component.root.findAllByProps({ testID: 'wiki-undo-k0' })).toHaveLength(0)
        await act(async () => component.root.findByProps({ testID: 'wiki-undo-k1' }).props.onPress())
        expect(undoKnowledgeCorrection).toHaveBeenCalledWith('p1', 'k1')
    })

    it('says why an undo failed', async () => {
        getKnowledgePageRevisions.mockResolvedValue([
            { id: '000003', revision: 3, mode: 'correction', author: { correctionId: 'k1', name: 'Karsten' } },
        ])
        undoKnowledgeCorrection.mockRejectedValue(new Error('The page changed after this correction.'))
        setWikiSelectedSlug('p1', 'entscheidungen')
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })
        await act(async () => {
            pressText(component, 'Show history')
        })

        await act(async () => component.root.findByProps({ testID: 'wiki-undo-k1' }).props.onPress())

        expect(textOf(component.root.findByProps({ testID: 'wiki-history' }).children)).toContain(
            'The page changed after this correction.'
        )
    })

    describe('what a revision changed', () => {
        const CORRECTION = {
            id: '000003',
            revision: 3,
            title: 'Kunden',
            summary: 'Kunden summary',
            body: 'Acme ist seit März Kunde.\nZweite Zeile.',
            sourceKeys: ['task:t1', 'correction:k1'],
            mode: 'correction',
            reason: 'Acme ist seit März Kunde',
            author: { type: 'user', userId: 'u2', name: 'Maria', correctionId: 'k1' },
            createdAt: Date.UTC(2026, 9, 20, 8),
        }
        const BEFORE = {
            revision: 2,
            title: 'Kunden',
            summary: 'Kunden summary',
            body: 'Acme ist seit Mai Kunde.\nZweite Zeile.',
            sourceKeys: ['task:t1'],
            mode: 'ingest',
        }

        it('opens from the page history, in place of the page, and keeps its own address', async () => {
            getKnowledgePageRevisions.mockResolvedValue([CORRECTION])
            getKnowledgePageChange.mockResolvedValue({ revision: CORRECTION, previous: BEFORE, page: PAGES[1] })
            setWikiSelectedSlug('p1', 'kunden')
            const component = mount()
            deliver({ knowledgeBase: { enabled: true }, pages: PAGES })
            await act(async () => {
                pressText(component, 'Show history')
            })

            await act(async () => press(component, 'wiki-history-changes-3'))

            expect(getWikiSelectedRevision('p1')).toBe(3)
            expect(getKnowledgePageChange).toHaveBeenCalledWith('p1', 'kunden', 3)
            expect(component.root.findAllByProps({ testID: 'wiki-page-kunden' })).toHaveLength(0)
            expect(URLsWiki.push).toHaveBeenLastCalledWith(
                'PROJECT_WIKI_PAGE_CHANGE',
                null,
                'p1',
                'kunden',
                'Kunden',
                3
            )
            expect(textOf(component.root.findByProps({ testID: 'wiki-change-description' }).children)).toBe(
                'Maria corrected the page “Kunden”'
            )
            const body = component.root.findByProps({ testID: 'wiki-diff-body' })
            expect(body.findAllByProps({ testID: 'wiki-diff-removed' })).toHaveLength(1)
            expect(textOf(body.findAllByProps({ testID: 'wiki-diff-added' })[0].children)).toContain('März')
            expect(textOf(component.root.findByProps({ testID: 'wiki-change-sources' }).children)).toContain(
                'Correction'
            )

            press(component, 'wiki-change-back')
            expect(getWikiSelectedRevision('p1')).toBeNull()
            expect(component.root.findAllByProps({ testID: 'wiki-page-kunden' })).not.toHaveLength(0)
        })

        it('shows a change of a page nobody can open any more, even with no page left to show', async () => {
            getKnowledgePageChange.mockResolvedValue({
                revision: { id: '000004', revision: 4, archived: true, mode: 'ingest', createdAt: 1 },
                previous: { ...BEFORE, title: 'Alt' },
                page: { slug: 'alt', title: 'Alt', revision: 4, archived: true, needsRebuild: false },
            })
            setWikiSelectedSlug('p1', 'alt', 4)
            const component = mount()
            await act(async () => deliver({ knowledgeBase: { enabled: true }, pages: [] }))

            expect(component.root.findAllByProps({ testID: 'wiki-building' })).toHaveLength(0)
            expect(textOf(component.root.findByProps({ testID: 'wiki-change-description' }).children)).toBe(
                'The wiki archived the page “Alt”'
            )
            expect(component.root.findAllByProps({ testID: 'wiki-change-open-page' })).toHaveLength(0)
            expect(textOf(component.root.findByProps({ testID: 'wiki-change-back' }).children)).toBe('All wiki pages')
            const body = component.root.findByProps({ testID: 'wiki-diff-body' })
            expect(body.findAllByProps({ testID: 'wiki-diff-removed' })).toHaveLength(2)
        })

        it('shows no text at all for a revision the wiki removed it from', async () => {
            getKnowledgePageChange.mockResolvedValue({
                revision: { id: '000003', revision: 3, redacted: true, mode: 'ingest', createdAt: 1 },
                previous: BEFORE,
                page: PAGES[1],
            })
            setWikiSelectedSlug('p1', 'kunden', 3)
            const component = mount()
            await act(async () => deliver({ knowledgeBase: { enabled: true }, pages: PAGES }))

            expect(component.root.findAllByProps({ testID: 'wiki-change-redacted' })).not.toHaveLength(0)
            expect(component.root.findAllByProps({ testID: 'wiki-diff-body' })).toHaveLength(0)
            expect(textOf(component.toJSON())).not.toContain('seit Mai')
        })

        it('steps to the older and the newer change of the same page', async () => {
            getKnowledgePageChange.mockResolvedValue({
                revision: CORRECTION,
                previous: BEFORE,
                page: { ...PAGES[1], revision: 5 },
            })
            setWikiSelectedSlug('p1', 'kunden', 3)
            const component = mount()
            await act(async () => deliver({ knowledgeBase: { enabled: true }, pages: PAGES }))

            await act(async () => press(component, 'wiki-change-newer'))
            expect(getWikiSelectedRevision('p1')).toBe(4)
            await act(async () => press(component, 'wiki-change-older'))
            expect(getWikiSelectedRevision('p1')).toBe(3)
        })
    })
})
