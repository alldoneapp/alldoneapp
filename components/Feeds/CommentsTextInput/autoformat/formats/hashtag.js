import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'

import HashtagWrapper from '../tags/HashtagWrapper'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class Hashtag extends Embed {
    static create(hashtagData) {
        const { text, id, editorId, userIdAllowedToEditTags } = hashtagData
        const node = super.create(text)
        const refs = Hashtag.refs

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('hashtagValue', text)
        node.setAttribute('contenteditable', false)

        Hashtag.data = text
        Hashtag.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <HashtagWrapper data={hashtagData} />
            </Provider>,
            node
        )

        return node
    }

    static value(domNode) {
        const hashtagData = {
            text: domNode.getAttribute('hashtagValue'),
            id: domNode.getAttribute('data-id'),
            editorId: domNode.getAttribute('editorId'),
            userIdAllowedToEditTags: domNode.getAttribute('userIdAllowedToEditTags'),
        }
        return hashtagData
    }

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Hashtag.data
    }
}

Hashtag.blotName = 'hashtag'
Hashtag.className = 'ql-hashtag'
Hashtag.tagName = 'span'
