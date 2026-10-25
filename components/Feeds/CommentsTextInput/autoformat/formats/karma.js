import React from 'react'
import v4 from 'uuid/v4'
import { Provider } from 'react-redux'

import KarmaTag from '../../../../Tags/KarmaTag'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export default class Karma extends ReactEmbedBlot {
    static create(attachmentData) {
        const { userId, editorId } = attachmentData
        const text = 'Karma'
        const node = super.create(text)
        const id = v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('contenteditable', false)
        node.setAttribute('userId', userId)
        node.setAttribute('editorId', editorId)

        Karma.data = text

        renderEmbedContent(
            node,
            <Provider store={store}>
                <KarmaTag userId={userId} />
            </Provider>
        )

        return node
    }

    static value(domNode) {
        const commentData = {
            text: domNode.getAttribute('text'),
            id: domNode.getAttribute('data-id'),
            userId: domNode.getAttribute('userId'),
            editorId: domNode.getAttribute('editorId'),
        }
        return commentData
    }

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Karma.data
    }
}

Karma.blotName = 'karma'
Karma.className = 'ql-karma'
Karma.tagName = 'span'
