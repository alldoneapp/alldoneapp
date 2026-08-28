import React, { createRef } from 'react'
import ReactQuill from 'react-quill-new'
import { Provider } from 'react-redux'

import HashtagWrapper from '../tags/HashtagWrapper'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'

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

        renderEmbedContent(
            node,
            <Provider store={store}>
                <HashtagWrapper data={hashtagData} />
            </Provider>
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

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Hashtag.data
    }
}

Hashtag.blotName = 'hashtag'
Hashtag.className = 'ql-hashtag'
Hashtag.tagName = 'span'
