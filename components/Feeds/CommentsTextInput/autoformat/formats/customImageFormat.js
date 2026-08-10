import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import v4 from 'uuid/v4'

import CustomImageContainer from '../tags/CustomImageContainer'
import { getPopoverWidth } from '../../../../../utils/HelperFunctions'
import { Provider } from 'react-redux'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class CustomImageFormat extends Embed {
    static create(imageData) {
        const { text, uri, resizedUri, isNew, externalId, isLoading, editorId } = imageData
        const node = super.create(text)
        const refs = CustomImageFormat.refs
        const id = externalId ? externalId : v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('uri', uri)
        node.setAttribute('resizedUri', resizedUri)
        node.setAttribute('contenteditable', false)
        node.setAttribute('isNew', isNew)
        node.setAttribute('isLoading', isLoading)
        node.setAttribute('editorId', editorId)

        CustomImageFormat.data = text
        CustomImageFormat.refs = {
            ...refs,
            [id]: createRef(),
        }

        // Get the editor width
        const maxWidth = getPopoverWidth() - 64
        ReactDOM.render(
            <Provider store={store}>
                <CustomImageContainer
                    editorId={editorId}
                    uri={uri}
                    resizedUri={resizedUri}
                    isLoading={isLoading}
                    maxWidth={maxWidth}
                />
            </Provider>,
            node
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

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = CustomImageFormat.data
    }
}

CustomImageFormat.blotName = 'customImageFormat'
CustomImageFormat.className = 'ql-customImageFormat'
CustomImageFormat.tagName = 'span'
