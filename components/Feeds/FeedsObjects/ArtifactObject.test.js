import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockActiveModalInFeed = false
jest.mock('react-redux', () => ({
    useSelector: selector => selector({ activeModalInFeed: mockActiveModalInFeed, isMiddleScreen: false }),
}))
jest.mock('../../ArtifactsView/artifactLinks', () => ({ openProjectArtifacts: jest.fn() }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    __esModule: true,
    default: { navigateToUserProfile: jest.fn() },
    getUserPresentationDataInProject: (projectId, userId) =>
        ({ owner: { shortName: 'Karsten', photoURL: 'k.png' }, anna: { shortName: 'Anna', photoURL: 'a.png' } })[
            userId
        ] || { shortName: '', photoURL: '' },
}))
jest.mock('../Utils/HelperFunctions', () => ({
    generatorParserImageElement: (style, uri) => ({ type: 'image', style, uri }),
    generatorParserTextElement: (style, text) => ({ type: 'text', style, text }),
}))
jest.mock('../TextParser/MultilineParser', () => {
    const { Text: MockText } = require('react-native')
    return ({ elementsData }) => (
        <MockText testID="feed-line">{elementsData.map(element => element.text || '').join('')}</MockText>
    )
})
jest.mock('../Commons/FeedsTypesLeftHeader', () => () => null)
jest.mock('../FeedUndoAction', () => () => null)
jest.mock('../../Icon', () => {
    const { Text: MockText } = require('react-native')
    return { __esModule: true, default: ({ name }) => <MockText testID="icon">{name}</MockText> }
})
jest.mock('../../../i18n/TranslationService', () => {
    const en = require('../../../i18n/translations/en.json')
    return {
        translate: (key, values = {}) =>
            (en[key] !== undefined ? en[key] : key).replace(/%\{(\w+)\}/g, (_, name) =>
                values[name] !== undefined ? values[name] : ''
            ),
    }
})

import ArtifactObject from './ArtifactObject'
import { openProjectArtifacts } from '../../ArtifactsView/artifactLinks'

const textOf = node => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    return node && node.children ? node.children.map(textOf).join('') : ''
}

const OBJECT = {
    id: 'a1',
    type: 'artifact',
    artifactId: 'a1',
    name: 'Sales dashboard',
    kind: 'web',
    isPublicFor: [0, 'owner'],
    isDeleted: false,
    lastChangeDate: 2,
}
const FEEDS = [
    {
        id: 'artifact_a1_version-v2',
        type: 'FEED_ARTIFACT_VERSION_SAVED',
        objectId: 'a1',
        creatorId: 'owner',
        entryText: 'saved version 2 • Adds Q3',
        via: 'mcp',
        viaClient: 'Claude',
        lastChangeDate: 2,
    },
    {
        id: 'artifact_a1_version-v1',
        type: 'FEED_ARTIFACT_CREATED',
        objectId: 'a1',
        creatorId: 'anna',
        entryText: 'created artifact',
        lastChangeDate: 1,
    },
]

const icons = tree => tree.root.findAllByProps({ testID: 'icon' }, { deep: false }).map(icon => icon.props.children)
const header = tree => tree.root.findAllByProps({ testID: 'artifact-feed-header' }, { deep: false })[0]

const mounted = []
function render(object = OBJECT, feeds = FEEDS) {
    let tree
    act(() => {
        tree = renderer.create(
            <ArtifactObject feedObjectData={{ object, feeds }} projectId="p1" feedActiveTab={1} style={null} />
        )
    })
    mounted.push(tree)
    return tree
}

afterEach(() => {
    act(() => mounted.splice(0).forEach(tree => tree.unmount()))
    jest.clearAllMocks()
    mockActiveModalInFeed = false
})

describe('an artifact in Updates', () => {
    it('shows the artifact and one line per change, naming the MCP client and the assistant', () => {
        const tree = render()
        expect(icons(tree)).toEqual(['package'])
        expect(textOf(tree.toJSON())).toContain('Sales dashboard')

        const lines = tree.root
            .findAllByProps({ testID: 'feed-line' }, { deep: false })
            .map(line => line.props.children)
        expect(lines).toEqual(['Karsten (via Claude) saved version 2 • Adds Q3', 'Anna created artifact'])
    })

    it('opens the artifact from its header', () => {
        const tree = render()
        act(() => header(tree).props.onPress())
        expect(openProjectArtifacts).toHaveBeenCalledWith('p1', 'a1')
    })

    it('marks a private artifact and cannot open a deleted one', () => {
        const privateTree = render({ ...OBJECT, isPrivate: true })
        expect(icons(privateTree)).toEqual(['package', 'lock'])

        const deletedTree = render({ ...OBJECT, isDeleted: true })
        expect(header(deletedTree).props.disabled).toBe(true)
        expect(icons(deletedTree)).toEqual(['trash-2'])
    })

    it('is not pressable while a modal of the feed is open', () => {
        mockActiveModalInFeed = true
        const tree = render()
        expect(header(tree).props.disabled).toBe(true)
    })

    it('falls back to the object id and a generic name for an old card', () => {
        const tree = render({ ...OBJECT, artifactId: undefined, name: '' })
        expect(textOf(tree.toJSON())).toContain('Artifact')
        act(() => header(tree).props.onPress())
        expect(openProjectArtifacts).toHaveBeenCalledWith('p1', 'a1')
    })
})
