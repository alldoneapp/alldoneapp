import React from 'react'
import v4 from 'uuid/v4'

import CustomImageContainer from '../tags/CustomImageContainer'
import { getPopoverWidth } from '../../../../../utils/HelperFunctions'
import { Provider } from 'react-redux'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export default class CustomImageFormat extends ReactEmbedBlot {
    static create(imageData) {
        const { text, uri, resizedUri, isNew, externalId, isLoading, editorId } = imageData
        const node = super.create(text)
        const id = externalId ? externalId : v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('uri', uri)
        node.setAttribute('resizedUri', resizedUri)
        node.setAttribute('contenteditable', false)
        node.setAttribute('isNew', isNew)
        // setAttribute stringifies, so an absent value would round-trip through
        // static value() as the literal string 'undefined' and key the per-editor project
        // map with it (AT-2227). Leave the attribute off instead.
        if (isLoading != null) node.setAttribute('isLoading', isLoading)
        if (editorId != null) node.setAttribute('editorId', editorId)

        CustomImageFormat.data = text

        // Get the editor width
        const maxWidth = getPopoverWidth() - 64
        renderEmbedContent(
            node,
            <Provider store={store}>
                <CustomImageContainer
                    editorId={editorId}
                    uri={uri}
                    resizedUri={resizedUri}
                    isLoading={isLoading}
                    maxWidth={maxWidth}
                />
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
        this.data = CustomImageFormat.data
    }
}

CustomImageFormat.blotName = 'customImageFormat'
CustomImageFormat.className = 'ql-customImageFormat'
CustomImageFormat.tagName = 'span'
