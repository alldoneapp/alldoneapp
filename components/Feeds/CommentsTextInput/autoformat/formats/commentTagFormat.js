import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'
import v4 from 'uuid/v4'

import CommentTagFormatContainer from '../tags/CommentTagFormatContainer'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class CommentTagFormat extends Embed {
    static create(commentData) {
        const { text, editorId, projectId, parentObjectId, parentType, assistantId } = commentData
        const node = super.create(text)
        const refs = CommentTagFormat.refs
        const id = v4()

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('commentValue', text)
        node.setAttribute('contenteditable', false)
        node.setAttribute('projectId', projectId)
        node.setAttribute('parentObjectId', parentObjectId)
        node.setAttribute('parentType', parentType)
        node.setAttribute('assistantId', assistantId)

        CommentTagFormat.data = text
        CommentTagFormat.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <CommentTagFormatContainer
                    projectId={projectId}
                    parentObjectId={parentObjectId}
                    parentType={parentType}
                    assistantId={assistantId}
                />
            </Provider>,
            node
        )

        return node
    }

    static value(domNode) {
        const commentData = {
            id: domNode.getAttribute('data-id'),
            text: domNode.getAttribute('commentValue'),
            editorId: domNode.getAttribute('editorId'),
            projectId: domNode.getAttribute('projectId'),
            parentObjectId: domNode.getAttribute('parentObjectId'),
            parentType: domNode.getAttribute('parentType'),
            assistantId: domNode.getAttribute('assistantId'),
        }
        return commentData
    }

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = CommentTagFormat.data
    }
}

CommentTagFormat.blotName = 'commentTagFormat'
CommentTagFormat.className = 'ql-commentTagFormat'
CommentTagFormat.tagName = 'span'
