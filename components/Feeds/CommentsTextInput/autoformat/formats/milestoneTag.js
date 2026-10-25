import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../../../redux/store'
import MilestoneTagWrapper from '../tags/MilestoneTagWrapper'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

export default class MilestoneTag extends ReactEmbedBlot {
    static create(milestoneTagData) {
        const { text, id, editorId, milestoneId, userIdAllowedToEditTags } = milestoneTagData
        const node = super.create(text)

        node.setAttribute('data-id', id)
        node.setAttribute('editorId', editorId)
        node.setAttribute('userIdAllowedToEditTags', userIdAllowedToEditTags)
        node.setAttribute('milestoneValue', text)
        node.setAttribute('milestoneId', milestoneId)
        node.setAttribute('contenteditable', false)

        MilestoneTag.data = text

        renderEmbedContent(
            node,
            <Provider store={store}>
                <MilestoneTagWrapper milestoneId={milestoneId} text={text} />
            </Provider>
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

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = MilestoneTag.data
    }
}

MilestoneTag.blotName = 'milestoneTag'
MilestoneTag.className = 'ql-milestone-tag'
MilestoneTag.tagName = 'span'
