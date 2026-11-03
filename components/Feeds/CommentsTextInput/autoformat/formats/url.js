import React, { createRef } from 'react'
import { Provider } from 'react-redux'
import Backend from '../../../../../utils/BackendBridge'
import UrlWrapper from '../tags/UrlWrapper'
import store from '../../../../../redux/store'
import { getInternalLinkType, handleNestedLinks } from '../../../../../utils/LinkingHelper'
import { isPrivateNote } from '../../../../NotesView/NotesHelper'
import { renderEmbedContent } from './embedReactRoot'
import ReactEmbedBlot from './reactEmbedBlot'

const DEFAULT_URL = {
    open: false,
    url: '',
    type: '',
    urlBoundary: '',
    id: '',
    editorId: '',
    userIdAllowedToEditTags: false,
}

class Url extends ReactEmbedBlot {
    static create(value = DEFAULT_URL) {
        let node = super.create(value)
        node.setAttribute('open', value.open)
        node.setAttribute('href', value.url)
        node.setAttribute('urlType', value.type)
        node.setAttribute('urlBoundary', value.urlBoundary)
        node.setAttribute('data-id', value.id)
        node.setAttribute('editorId', value.editorId)
        node.setAttribute('userIdAllowedToEditTags', value.userIdAllowedToEditTags)
        node.setAttribute('contenteditable', false)
        Url.data = value

        // What is rendered follows the link, not only the stored `type`: a chip stored as `plain`
        // can still point at a note (AT-2950, see getInternalLinkType). The stored value and the
        // node's attributes are left exactly as they were, so nothing is written back.
        const renderValue = resolveUrlRenderValue(value)

        // Special handling for preConfigTask - extract name from URL query params
        if (renderValue.type === 'preConfigTask' && value?.url) {
            let taskName = ''
            try {
                const urlObj = new URL(value.url)
                taskName = urlObj.searchParams.get('name') || ''
                if (taskName) {
                    taskName = decodeURIComponent(taskName)
                }
            } catch (e) {
                // Ignore URL parsing errors
            }

            renderEmbedContent(
                node,
                <Provider store={store}>
                    <UrlWrapper
                        value={renderValue}
                        objectName={taskName || 'Pre-configured Task'}
                        isShared={false}
                        embedNode={node}
                    />
                </Provider>
            )
        } else if (renderValue.type !== 'plain' && value?.url) {
            Backend.getObjectFromUrl(renderValue.type, value.url, ({ object, objectName, error }, externalContact) => {
                const text = handleNestedLinks(objectName)
                const isShared =
                    (object?.hasOwnProperty('userIds') || object?.hasOwnProperty('stickyData')) &&
                    !isPrivateNote(object)

                // A read that FAILED says nothing about the object (a transient
                // `permission-denied`, AT-2484): keep the chip typed and let LinkTag's own
                // listener fill in the title. Only an answered "does not exist" demotes it.
                renderEmbedContent(
                    node,
                    <Provider store={store}>
                        <UrlWrapper
                            value={object || error ? renderValue : { ...renderValue, type: 'plain' }}
                            objectName={object ? text : null}
                            isShared={object ? isShared : null}
                            externalContact={object ? externalContact : null}
                            embedNode={node}
                        />
                    </Provider>
                )
            })
        } else {
            renderEmbedContent(
                node,
                <Provider store={store}>
                    <UrlWrapper value={value} embedNode={node} />
                </Provider>
            )
        }
        return node
    }

    static value(domNode) {
        const urlData = {
            open: domNode.getAttribute('open'),
            urlBoundary: domNode.getAttribute('urlBoundary'),
            type: domNode.getAttribute('urlType'),
            id: domNode.getAttribute('data-id'),
            editorId: domNode.getAttribute('editorId'),
            url: domNode.getAttribute('href'),
            userIdAllowedToEditTags: domNode.getAttribute('userIdAllowedToEditTags'),
        }
        return urlData
        //return domNode.__blot.blot.data
    }

    constructor(scroll, domNode) {
        super(scroll, domNode)
        this.id = domNode.getAttribute('data-id')
        this.data = Url.data
    }

    static formats(node) {
        return {}
    }
}
export const resolveUrlRenderValue = value => {
    if (!value || (value.type && value.type !== 'plain')) return value
    const internalType = getInternalLinkType(value.url)
    return internalType ? { ...value, type: internalType } : value
}

Url.blotName = 'url'
Url.className = 'ql-url'
Url.tagName = 'span'
Url.ref = {}
Url.urlItemRef = createRef()
Url.BASE_URL = '#'

export { Url as default }
