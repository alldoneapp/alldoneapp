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
    getKnowledgePageRevisions,
    undoKnowledgeCorrection,
} from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import WikiView from './WikiView'
import { openProjectWikiSettings, openWikiSource } from './wikiLinks'
import { setWikiSelectedSlug } from './wikiNavigationState'

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

    it('shows the index beside the first page on a wide screen and opens another page', () => {
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        expect(component.root.findAllByProps({ testID: 'wiki-page-entscheidungen' })).not.toHaveLength(0)
        expect(URLsWiki.push).toHaveBeenLastCalledWith(
            'PROJECT_WIKI_PAGE',
            null,
            'p1',
            'entscheidungen',
            'Entscheidungen'
        )

        press(component, 'wiki-index-kunden')

        expect(component.root.findAllByProps({ testID: 'wiki-page-kunden' })).not.toHaveLength(0)
        expect(URLsWiki.push).toHaveBeenLastCalledWith('PROJECT_WIKI_PAGE', null, 'p1', 'kunden', 'Kunden')
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

    it('makes the index its own screen on a phone', () => {
        mockState.smallScreenNavigation = true
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        expect(component.root.findAllByProps({ testID: 'wiki-index' })).not.toHaveLength(0)
        expect(component.root.findAllByProps({ testID: 'wiki-page-entscheidungen' })).toHaveLength(0)
        expect(URLsWiki.push).toHaveBeenLastCalledWith('PROJECT_WIKI', null, 'p1')

        press(component, 'wiki-index-kunden')
        expect(component.root.findAllByProps({ testID: 'wiki-index' })).toHaveLength(0)

        pressText(component, 'All wiki pages')
        expect(component.root.findAllByProps({ testID: 'wiki-index' })).not.toHaveLength(0)
    })

    it('loads the history on demand and says when a revision lost its text', async () => {
        getKnowledgePageRevisions.mockResolvedValue([
            { id: '000003', revision: 3, createdAt: Date.UTC(2026, 9, 20, 8), reason: 'Neuer Kunde' },
            { id: '000002', revision: 2, createdAt: Date.UTC(2026, 9, 19, 8), redacted: true },
        ])
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
    it('opens the correction form for the page on display', () => {
        const component = mount()
        deliver({ knowledgeBase: { enabled: true }, pages: PAGES })

        press(component, 'wiki-suggest-correction')

        expect(textOf(component.root.findByProps({ testID: 'wiki-correction-form' }).children)).toBe(
            'correcting entscheidungen'
        )
        expect(component.root.findAllByProps({ testID: 'wiki-suggest-correction' })).toHaveLength(0)
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
})
