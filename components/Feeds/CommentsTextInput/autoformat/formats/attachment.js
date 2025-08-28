import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import v4 from 'uuid/v4'
import { Provider } from 'react-redux'

import FileDownloadableTag from '../../../../Tags/FileDownloadableTag'
import store from '../../../../../redux/store'
import { quillTextInputProjectIds } from '../../CustomTextInput3'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class Attachment extends Embed {
    static create(attachmentData) {
        const { text, uri, isNew, externalId, isLoading, editorId } = attachmentData
        const node = super.create(text)
        const refs = Attachment.refs
        const id = externalId ? externalId : v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('uri', uri)
        node.setAttribute('isNew', isNew)
        node.setAttribute('contenteditable', false)
        node.setAttribute('isLoading', isLoading)
        node.setAttribute('editorId', editorId)

        Attachment.data = text
        Attachment.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <FileDownloadableTag
                    projectId={quillTextInputProjectIds[editorId]}
                    text={text}
                    uri={uri}
                    isLoading={isLoading}
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
        this.data = Attachment.data
    }
}

Attachment.blotName = 'attachment'
Attachment.className = 'ql-attachment'
Attachment.tagName = 'span'
