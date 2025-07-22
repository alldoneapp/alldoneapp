import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import v4 from 'uuid/v4'

import CustomVideoContainer from '../tags/CustomVideoContainer'
import { Provider } from 'react-redux'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class VideoFormat extends Embed {
    static create(videoData) {
        const { text, uri, isNew, externalId, isLoading, editorId } = videoData
        const node = super.create(text)
        const refs = VideoFormat.refs
        const id = externalId ? externalId : v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('uri', uri)
        node.setAttribute('contenteditable', false)
        node.setAttribute('isNew', isNew)
        node.setAttribute('isLoading', isLoading)
        node.setAttribute('editorId', editorId)

        VideoFormat.data = text
        VideoFormat.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <CustomVideoContainer editorId={editorId} uri={uri} isLoading={isLoading} />
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
        this.data = VideoFormat.data
    }
}

VideoFormat.blotName = 'videoFormat'
VideoFormat.className = 'ql-videoFormat'
VideoFormat.tagName = 'span'
