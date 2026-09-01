import React from 'react'
import v4 from 'uuid/v4'

import CustomVideoContainer from '../tags/CustomVideoContainer'
import { Provider } from 'react-redux'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export default class VideoFormat extends ReactEmbedBlot {
    static create(videoData) {
        const { text, uri, isNew, externalId, isLoading, editorId } = videoData
        const node = super.create(text)
        const id = externalId ? externalId : v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('uri', uri)
        node.setAttribute('contenteditable', false)
        node.setAttribute('isNew', isNew)
        // See customImageFormat: never stamp the literal string 'undefined' (AT-2227).
        if (isLoading != null) node.setAttribute('isLoading', isLoading)
        if (editorId != null) node.setAttribute('editorId', editorId)

        VideoFormat.data = text

        renderEmbedContent(
            node,
            <Provider store={store}>
                <CustomVideoContainer editorId={editorId} uri={uri} isLoading={isLoading} />
            </Provider>
        )

        return node
    }

    static value(domNode) {
        const commentData = {
            text: domNode.getAttribute('text'),
            uri: domNode.getAttribute('uri'),
            resizedUri: domNode.getAttribute('resizedUri'),
            id: domNode.getAttribute('data-id'),
            isNew: domNode.getAttribute('isNew'),
            isLoading: domNode.getAttribute('isLoading'),
            editorId: domNode.getAttribute('editorId'),
        }
        return commentData
    }

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = VideoFormat.data
    }
}

VideoFormat.blotName = 'videoFormat'
VideoFormat.className = 'ql-videoFormat'
VideoFormat.tagName = 'span'
