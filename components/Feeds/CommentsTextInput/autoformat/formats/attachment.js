import React, { createRef } from 'react'
import ReactQuill from 'react-quill-new'
import v4 from 'uuid/v4'
import { Provider } from 'react-redux'

import FileDownloadableTag from '../../../../Tags/FileDownloadableTag'
import store from '../../../../../redux/store'
import { quillTextInputProjectIds } from '../../CustomTextInput3'
import { renderEmbedContent } from './embedReactRoot'

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
        // See customImageFormat: never stamp the literal string 'undefined' (AT-2227).
        if (isLoading != null) node.setAttribute('isLoading', isLoading)
        if (editorId != null) node.setAttribute('editorId', editorId)

        Attachment.data = text
        Attachment.refs = {
            ...refs,
            [id]: createRef(),
        }

        renderEmbedContent(
            node,
            <Provider store={store}>
                <FileDownloadableTag
                    projectId={quillTextInputProjectIds[editorId]}
                    text={text}
                    uri={uri}
                    isLoading={isLoading}
                />
            </Provider>
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

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Attachment.data
    }
}

Attachment.blotName = 'attachment'
Attachment.className = 'ql-attachment'
Attachment.tagName = 'span'
