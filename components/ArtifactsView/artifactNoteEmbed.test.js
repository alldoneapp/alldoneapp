/**
 * @jest-environment jsdom
 *
 * An artifact in a note switches between a link chip and a live preview card. These drive a REAL
 * quill 2 with the REAL artifactEmbed format (only the card's React content is a double), because
 * what matters is that the switch replaces exactly the one embed, keeps the text around it, and
 * survives quill's own serialisation of the blot.
 */
import React from 'react'
import Quill from 'quill'

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({}), subscribe: () => () => {}, dispatch: () => {} },
}))
jest.mock('../../utils/backends/firestore', () => ({ getAppUrlHost: () => 'my.alldone.app' }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ __esModule: true, default: {} }))
const mockCards = []
jest.mock('./ArtifactEmbedCard', () => {
    const React = require('react')
    return {
        __esModule: true,
        default: props => {
            mockCards.push(props)
            return React.createElement('span', { className: 'artifact-card' }, props.title)
        },
    }
})

import ArtifactEmbed from '../Feeds/CommentsTextInput/autoformat/formats/artifactEmbed'
import {
    buildArtifactEmbedValue,
    findEmbedIndex,
    locateEmbed,
    showArtifactLinkAsPreview,
    showArtifactPreviewAsLink,
} from './artifactNoteEmbed'

// The app's link chip is a React blot of its own; for this test only its value matters.
class UrlStub extends Quill.import('blots/embed') {
    static create(value) {
        const node = super.create(value)
        node.setAttribute('data-value', JSON.stringify(value))
        return node
    }
    static value(domNode) {
        return JSON.parse(domNode.getAttribute('data-value'))
    }
}
UrlStub.blotName = 'url'
UrlStub.tagName = 'span'
UrlStub.className = 'ql-url-stub'

Quill.register(UrlStub, true)
Quill.register(ArtifactEmbed, true)

const URL = 'https://my.alldone.app/projects/p1/artifacts/a1'

const buildEditor = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return new Quill(host)
}

describe('artifacts in a note', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        mockCards.length = 0
    })

    it('reads the artifact out of its in-app URL', () => {
        expect(buildArtifactEmbedValue({ url: URL, title: 'Churn', editorId: 'n1' })).toEqual({
            url: URL,
            projectId: 'p1',
            artifactId: 'a1',
            title: 'Churn',
            editorId: 'n1',
        })
    })

    it('finds an embed by its own id, counting text and other embeds', () => {
        const ops = [{ insert: 'ab' }, { insert: { url: { id: 'x' } } }, { insert: { url: { id: 'y' } } }]
        expect(findEmbedIndex(ops, 'url', 'y')).toBe(3)
        expect(findEmbedIndex(ops, 'url', 'missing')).toBe(-1)
    })

    it('turns a link chip into a preview card in place, and back again', () => {
        const quill = buildEditor()
        quill.setContents([
            { insert: 'See ' },
            { insert: { url: { id: 'tag-1', url: URL, type: 'artifact' } } },
            { insert: ' for numbers\n' },
        ])

        expect(showArtifactLinkAsPreview(quill, 'tag-1', { url: URL, title: 'Churn', editorId: 'n1' })).toBe(true)

        const [, card] = quill.getContents().ops
        expect(card.insert.artifactEmbed).toMatchObject({
            url: URL,
            projectId: 'p1',
            artifactId: 'a1',
            title: 'Churn',
            editorId: 'n1',
        })
        expect(quill.getContents().ops.map(op => (typeof op.insert === 'string' ? op.insert : 'EMBED'))).toEqual([
            'See ',
            'EMBED',
            ' for numbers\n',
        ])
        expect(mockCards[0]).toMatchObject({ projectId: 'p1', artifactId: 'a1', url: URL })

        const embedNode = quill.root.querySelector('.ql-artifactEmbed')
        expect(locateEmbed(embedNode)).toMatchObject({ quill, index: 4 })

        expect(showArtifactPreviewAsLink(embedNode, { url: URL, projectId: 'p1', editorId: 'n1' })).toBe(true)
        const ops = quill.getContents().ops
        expect(ops[0].insert).toBe('See ')
        expect(ops[1].insert.url).toMatchObject({ url: URL, type: 'artifact', editorId: 'n1' })
        expect(ops[2].insert).toBe(' for numbers\n')
    })

    it('does nothing when the chip is not in the editor', () => {
        const quill = buildEditor()
        quill.setContents([{ insert: 'text\n' }])
        expect(showArtifactLinkAsPreview(quill, 'gone', { url: URL })).toBe(false)
        expect(showArtifactLinkAsPreview(null, 'gone', { url: URL })).toBe(false)
        expect(showArtifactPreviewAsLink(document.createElement('span'), { url: URL })).toBe(false)
    })

    it('keeps every field of the card through quill serialisation', () => {
        const quill = buildEditor()
        const value = { id: 'card-1', ...buildArtifactEmbedValue({ url: URL, title: 'Churn', editorId: 'n1' }) }
        quill.setContents([{ insert: { artifactEmbed: value } }, { insert: '\n' }])
        expect(quill.getContents().ops[0].insert.artifactEmbed).toEqual(value)
    })
})
