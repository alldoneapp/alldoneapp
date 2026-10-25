import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockState
let mockOnArtifact
const mockUnsubscribe = jest.fn()
const mockProcessUrl = jest.fn()
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    watchArtifact: jest.fn((projectId, artifactId, onChange) => {
        mockOnArtifact = onChange
        return mockUnsubscribe
    }),
}))
jest.mock('./ArtifactPreview', () => {
    const { Text } = require('react-native')
    return {
        __esModule: true,
        default: ({ artifact, height }) => <Text testID="preview">{`${artifact.id}:${height}`}</Text>,
    }
})
jest.mock('./artifactNoteEmbed', () => ({ showArtifactPreviewAsLink: jest.fn() }))
jest.mock('../Icon', () => () => null)
jest.mock('../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: mockProcessUrl } }))
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: {} }))

import ArtifactEmbedCard, { ARTIFACT_EMBED_PREVIEW_HEIGHT } from './ArtifactEmbedCard'
import { showArtifactPreviewAsLink } from './artifactNoteEmbed'

const URL = 'https://my.alldone.app/projects/p1/artifacts/a1'
const mounted = []
function render() {
    let tree
    act(() => {
        tree = renderer.create(
            <ArtifactEmbedCard projectId="p1" artifactId="a1" title="Churn" url={URL} editorId="n1" embedNode="node" />
        )
    })
    mounted.push(tree)
    return tree
}

describe('ArtifactEmbedCard', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { loggedUser: { isAnonymous: false }, activeNoteId: 'n1', activeNoteIsReadOnly: false }
    })
    afterEach(() => mounted.splice(0).forEach(tree => act(() => tree.unmount())))

    it('shows a live preview of the artifact the viewer can read, and opens it', () => {
        const tree = render()
        expect(tree.root.findAllByProps({ testID: 'preview' })).toHaveLength(0)

        act(() => mockOnArtifact({ id: 'a1', title: 'Churn dashboard' }))
        expect(tree.root.findByProps({ testID: 'preview' }).props.children).toBe(`a1:${ARTIFACT_EMBED_PREVIEW_HEIGHT}`)

        act(() => tree.root.findByProps({ testID: 'artifact-embed-open' }).props.onPress())
        expect(mockProcessUrl).toHaveBeenCalledWith({}, '/projects/p1/artifacts/a1')
    })

    it('says so when the artifact is gone or not readable, instead of showing anything of it', () => {
        const tree = render()
        act(() => mockOnArtifact(null))
        expect(tree.root.findByProps({ testID: 'artifact-embed-missing' })).toBeTruthy()
        expect(tree.root.findAllByProps({ testID: 'preview' })).toHaveLength(0)
    })

    it('turns back into a link only where the note can be edited', () => {
        const tree = render()
        act(() => tree.root.findByProps({ testID: 'artifact-embed-as-link' }).props.onPress())
        expect(showArtifactPreviewAsLink).toHaveBeenCalledWith('node', { url: URL, projectId: 'p1', editorId: 'n1' })

        mockState = { ...mockState, activeNoteIsReadOnly: true }
        const readOnly = render()
        expect(readOnly.root.findAllByProps({ testID: 'artifact-embed-as-link' })).toHaveLength(0)
    })

    it('stops watching when the card goes away', () => {
        const tree = render()
        act(() => tree.unmount())
        mounted.pop()
        expect(mockUnsubscribe).toHaveBeenCalled()
    })
})
