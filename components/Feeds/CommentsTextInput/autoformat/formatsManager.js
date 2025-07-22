import ReactDOM from 'react-dom'

const activeFormats = {}

export function addFormatContainer(container, editorId) {
    if (!activeFormats[editorId]) activeFormats[editorId] = []
    activeFormats[editorId].push(container)
}

export function unmountAllFormats(editorId) {
    if (activeFormats[editorId]) {
        activeFormats[editorId].forEach(container => {
            ReactDOM.unmountComponentAtNode(container)
        })
        delete activeFormats[editorId]
    }
}

export function removeAllFormatsReference(editorId) {
    if (activeFormats[editorId]) delete activeFormats[editorId]
}
