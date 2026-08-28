import React, { createRef } from 'react'
import ReactQuill from 'react-quill-new'
import { Provider } from 'react-redux'
import Backend from '../../../../../utils/BackendBridge'
import UrlWrapper from '../tags/UrlWrapper'
import store from '../../../../../redux/store'
import { handleNestedLinks } from '../../../../../utils/LinkingHelper'
import { isPrivateNote } from '../../../../NotesView/NotesHelper'
import { renderEmbedContent } from './embedReactRoot'

const Embed = ReactQuill.Quill.import('blots/embed')
const DEFAULT_URL = {
    open: false,
    url: '',
    type: '',
    urlBoundary: '',
    id: '',
    editorId: '',
    userIdAllowedToEditTags: false,
}

class Url extends Embed {
    static create(value = DEFAULT_URL) {
        let node = super.create(value)
        const refs = Url.refs
        node.setAttribute('open', value.open)
        node.setAttribute('href', value.url)
        node.setAttribute('urlType', value.type)
        node.setAttribute('urlBoundary', value.urlBoundary)
        node.setAttribute('data-id', value.id)
        node.setAttribute('editorId', value.editorId)
        node.setAttribute('userIdAllowedToEditTags', value.userIdAllowedToEditTags)
        node.setAttribute('contenteditable', false)
        Url.data = value
        Url.refs = {
            ...refs,
            [value.id]: React.createRef(),
        }

        // Special handling for preConfigTask - extract name from URL query params
        if (value.type === 'preConfigTask' && value?.url) {
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
                    <UrlWrapper value={value} objectName={taskName || 'Pre-configured Task'} isShared={false} />
                </Provider>
            )
        } else if (value.type !== 'plain' && value?.url) {
            Backend.getObjectFromUrl(value.type, value.url, ({ object, objectName }, externalContact) => {
                const text = handleNestedLinks(objectName)
                const isShared =
                    (object?.hasOwnProperty('userIds') || object?.hasOwnProperty('stickyData')) &&
                    !isPrivateNote(object)

                renderEmbedContent(
                    node,
                    <Provider store={store}>
                        <UrlWrapper
                            value={object ? value : { ...value, type: 'plain' }}
                            objectName={object ? text : null}
                            isShared={object ? isShared : null}
                            externalContact={object ? externalContact : null}
                        />
                    </Provider>
                )
            })
        } else {
            renderEmbedContent(
                node,
                <Provider store={store}>
                    <UrlWrapper value={value} />
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
Url.blotName = 'url'
Url.className = 'ql-url'
Url.tagName = 'span'
Url.ref = {}
Url.urlItemRef = createRef()
Url.BASE_URL = '#'

export { Url as default }
