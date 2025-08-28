import React, { createRef } from 'react'
import ReactQuill from 'react-quill'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'
import store from '../../../../../redux/store'
import MilestoneTagWrapper from "../tags/MilestoneTagWrapper";

const Embed = ReactQuill.Quill.import('blots/embed')

export default class MilestoneTag extends Embed {
    static create(milestoneTagData) {
        const { text, id, editorId, milestoneId, userIdAllowedToEditTags } = milestoneTagData
        const node = super.create(text)
        const refs = MilestoneTag.refs

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('milestoneValue', text)
        node.setAttribute('milestoneId', milestoneId)
        node.setAttribute('contenteditable', false)

        MilestoneTag.data = text
        MilestoneTag.refs = {
            ...refs,
            [id]: createRef(),
        }

        ReactDOM.render(
            <Provider store={store}>
                <MilestoneTagWrapper milestoneId={milestoneId} text={text} />
            </Provider>,
            node
        )

        return node
    }

    static value(domNode) {
        return {
            milestoneId: domNode.getAttribute('milestoneId'),
            text: domNode.getAttribute('milestoneValue'),
            id: domNode.getAttribute('data-id'),
            editorId: domNode.getAttribute('editorId'),
            userIdAllowedToEditTags: domNode.getAttribute('userIdAllowedToEditTags'),
        }
    }

    constructor(domNode) {
        super(domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = MilestoneTag.data
    }
}

MilestoneTag.blotName = 'milestoneTag'
MilestoneTag.className = 'ql-milestone-tag'
MilestoneTag.tagName = 'span'
