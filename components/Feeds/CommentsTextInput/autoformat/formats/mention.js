import React from 'react'
import { Provider } from 'react-redux'

import MentionWrapper from '../tags/MentionWrapper'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export default class Mention extends ReactEmbedBlot {
    static create(mentionData) {
        const { text, id, userId, editorId, userIdAllowedToEditTags } = mentionData
        const node = super.create(text)

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('mentionValue', text)
        node.setAttribute('userId', userId)
        node.setAttribute('contenteditable', false)

        Mention.data = text

        renderEmbedContent(
            node,
            <Provider store={store}>
                <MentionWrapper data={mentionData} />
            </Provider>
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

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Mention.data
    }
}

Mention.blotName = 'mention'
Mention.className = 'ql-mention'
Mention.tagName = 'span'
