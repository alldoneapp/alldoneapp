import Quill from 'quill'

import { formatUrl, getUrlObject } from '../../utils/LinkingHelper'

const Delta = Quill.import('delta')

// An artifact appears in a note in one of two shapes, and the person writing chooses: a link
// chip (the `url` embed every object link uses) or a preview card that shows the artifact itself
// (the `artifactEmbed` embed, ARTIFACTS_PLAN.md §7 idea 4). Both carry the artifact's in-app URL,
// so a note's backlinks see either one, and switching replaces the one embed with the other in
// place, as a single undoable change.

export const ARTIFACT_EMBED_BLOT = 'artifactEmbed'

export function buildArtifactEmbedValue({ url, title = '', editorId = '' }) {
    const parts = String(url || '').split('/')
    return {
        url,
        projectId: parts[4] || '',
        artifactId: parts[6] || '',
        title: String(title || ''),
        editorId: editorId || '',
    }
}

// Where in the document the embed whose own id is `id` sits, in Quill positions (every embed is
// one position long).
export function findEmbedIndex(ops, blotName, id) {
    let index = 0
    for (const op of ops || []) {
        const { insert } = op
        if (typeof insert === 'string') {
            index += insert.length
            continue
        }
        if (insert && insert[blotName] && insert[blotName].id === id) return index
        index += 1
    }
    return -1
}

function replaceEmbedAt(quill, index, insert) {
    quill.updateContents(new Delta().retain(index).delete(1).insert(insert), 'user')
}

// The link chip with tag id `tagId` becomes a preview card. Returns whether it found the chip.
export function showArtifactLinkAsPreview(quill, tagId, { url, title, editorId }) {
    if (!quill) return false
    const index = findEmbedIndex(quill.getContents().ops, 'url', tagId)
    if (index < 0) return false
    replaceEmbedAt(quill, index, { [ARTIFACT_EMBED_BLOT]: buildArtifactEmbedValue({ url, title, editorId }) })
    return true
}

// The quill instance and position of the embed rendered into `embedNode`, or null when the node is
// not (or no longer) part of an editor.
export function locateEmbed(embedNode) {
    if (!embedNode) return null
    const blot = Quill.find(embedNode)
    const root = blot?.scroll?.domNode
    const quill = root?.parentNode ? Quill.find(root.parentNode) : null
    if (!quill || typeof quill.getIndex !== 'function') return null
    return { quill, index: quill.getIndex(blot) }
}

// The preview card in `embedNode` becomes a link chip again.
export function showArtifactPreviewAsLink(embedNode, { url, projectId, editorId }) {
    const located = locateEmbed(embedNode)
    const rootUrl = url && formatUrl(url)
    if (!located || !rootUrl) return false
    replaceEmbedAt(located.quill, located.index, { url: getUrlObject(url, rootUrl, projectId, editorId) })
    return true
}
