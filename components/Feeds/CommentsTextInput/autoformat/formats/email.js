import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'

import EmailWrapper from '../tags/EmailWrapper'
import store from '../../../../../redux/store'

const Embed = ReactQuill.Quill.import('blots/embed')

export default class Email extends Embed {
    static create(emailData) {
        const { text, id, editorId, userIdAllowedToEditTags } = emailData
        const node = super.create(text)
        const refs = Email.refs

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('emailValue', text)
        node.setAttribute('contenteditable', false)

        Email.data = text
        Email.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <EmailWrapper data={emailData} />
            </Provider>,
            node
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

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Email.data
    }
}

Email.blotName = 'email'
Email.className = 'ql-email'
Email.tagName = 'span'
