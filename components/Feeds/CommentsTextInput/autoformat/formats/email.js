import React from 'react'
import { Provider } from 'react-redux'

import EmailWrapper from '../tags/EmailWrapper'
import store from '../../../../../redux/store'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export default class Email extends ReactEmbedBlot {
    static create(emailData) {
        const { text, id, editorId, userIdAllowedToEditTags } = emailData
        const node = super.create(text)

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('emailValue', text)
        node.setAttribute('contenteditable', false)

        Email.data = text

        renderEmbedContent(
            node,
            <Provider store={store}>
                <EmailWrapper data={emailData} />
            </Provider>
        )

        return node
    }

    static value(domNode) {
        const emailData = {
            text: domNode.getAttribute('emailValue'),
            id: domNode.getAttribute('data-id'),
            editorId: domNode.getAttribute('editorId'),
            userIdAllowedToEditTags: domNode.getAttribute('userIdAllowedToEditTags'),
        }
        return emailData
    }

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Email.data
    }
}

Email.blotName = 'email'
Email.className = 'ql-email'
Email.tagName = 'span'
