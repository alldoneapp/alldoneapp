import { UPLOAD_SOURCES, mergeLinkedUploads, sourceTitle } from '../../../functions/Artifacts/linkedUploadsModel'

// Linked uploads are found by the server (functions/Artifacts/linkedUploadsIndex.js, AT-2860); the
// browser only asks for them. It used to assemble them from live listeners on every source
// collection and every conversation of the project, which flooded the Firestore client.
export { UPLOAD_SOURCES, mergeLinkedUploads, sourceTitle }

// Where a source is seen in context. `inThread` names a source's conversation rather than the
// object itself: where an assistant created an artifact, or where a file was sent as a comment.
export function getUploadSourcePath(projectId, source) {
    const project = encodeURIComponent(projectId)
    const id = encodeURIComponent(source.id)
    if (source.type === 'okrs') return `/project/${project}/okrs`
    const inThread = !!source.commentId || !!source.inThread
    if (source.type === 'artifacts') return `/projects/${project}/artifacts/${id}${inThread ? '/chat' : ''}`
    const type = source.type === 'topics' ? 'chats' : source.type === 'users' ? 'contacts' : source.type
    const tab =
        inThread || ['topics', 'users', 'assistants'].includes(source.type)
            ? 'chat'
            : source.type === 'notes'
              ? 'editor'
              : 'properties'
    return `/projects/${project}/${type}/${id}/${tab}`
}
