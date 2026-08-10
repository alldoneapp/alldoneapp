import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'

import MentionWrapper from '../tags/MentionWrapper'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class Mention extends Embed {
    static create(mentionData) {
        const { text, id, userId, editorId, userIdAllowedToEditTags } = mentionData
        const node = super.create(text)
        const refs = Mention.refs

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('mentionValue', text)
        node.setAttribute('userId', userId)
        node.setAttribute('contenteditable', false)

        Mention.data = text
        Mention.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <MentionWrapper data={mentionData} />
            </Provider>,
            node
        )

        return node
    }

    static value(domNode) {
        const mentionData = {
            text: domNode.getAttribute('mentionValue'),
            id: domNode.getAttribute('data-id'),
            editorId: domNode.getAttribute('editorId'),
            userId: domNode.getAttribute('userId'),
            userIdAllowedToEditTags: domNode.getAttribute('userIdAllowedToEditTags'),
        }
        return mentionData
    }

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Mention.data
    }
}

Mention.blotName = 'mention'
Mention.className = 'ql-mention'
Mention.tagName = 'span'
