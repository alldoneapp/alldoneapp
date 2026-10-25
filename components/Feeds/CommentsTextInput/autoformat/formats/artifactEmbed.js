import React from 'react'
import { Provider } from 'react-redux'
import v4 from 'uuid/v4'

import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

const ATTRIBUTES = ['url', 'projectId', 'artifactId', 'title', 'editorId']

// A live preview card of an artifact inside a note (components/ArtifactsView/artifactNoteEmbed.js).
// The card is React, so it is mounted through renderEmbedContent and torn down by ReactEmbedBlot,
// never with ReactDOM.render on the blot's own node (AT-2454).
export default class ArtifactEmbed extends ReactEmbedBlot {
    static create(value = {}) {
        const node = super.create(value)
        const id = value.id || v4()
        node.setAttribute('data-id', id)
        ATTRIBUTES.forEach(name => node.setAttribute(`data-${name}`, value[name] || ''))
        node.setAttribute('contenteditable', false)

        // Required here rather than at the top: the card reaches the artifact backend and the
        // preview, which every module registering the editor formats would otherwise import.
        const ArtifactEmbedCard = require('../../../../ArtifactsView/ArtifactEmbedCard').default
        renderEmbedContent(
            node,
            <Provider store={store}>
                <ArtifactEmbedCard
                    projectId={value.projectId}
                    artifactId={value.artifactId}
                    title={value.title}
                    url={value.url}
                    editorId={value.editorId}
                    embedNode={node}
                />
            </Provider>,
            { editorId: value.editorId, kind: 'artifact', label: value.title, width: 560, height: 380 }
        )
        return node
    }

    static value(domNode) {
        const value = { id: domNode.getAttribute('data-id') }
        ATTRIBUTES.forEach(name => (value[name] = domNode.getAttribute(`data-${name}`) || ''))
        return value
    }
}

ArtifactEmbed.blotName = 'artifactEmbed'
ArtifactEmbed.className = 'ql-artifactEmbed'
ArtifactEmbed.tagName = 'span'
