import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import v4 from 'uuid/v4'
import { Provider } from 'react-redux'

import KarmaTag from '../../../../Tags/KarmaTag'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class Karma extends Embed {
    static create(attachmentData) {
        const { userId, editorId } = attachmentData
        const text = 'Karma'
        const node = super.create(text)
        const refs = Karma.refs
        const id = v4()

        node.setAttribute('data-id', id)
        node.setAttribute('text', text)
        node.setAttribute('contenteditable', false)
        node.setAttribute('userId', userId)
        node.setAttribute('editorId', editorId)

        Karma.data = text
        Karma.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <KarmaTag userId={userId} />
            </Provider>,
            node
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

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Karma.data
    }
}

Karma.blotName = 'karma'
Karma.className = 'ql-karma'
Karma.tagName = 'span'
