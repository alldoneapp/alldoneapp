/**
 * Uploads into the project-less attachment folders (`feedAttachments/`, `notesAttachments/`).
 *
 * Their paths carry no project, and every shared download URL reveals the full path, so
 * storage.rules binds each object to its uploader instead: a create must carry
 * `customMetadata.uploaderId` equal to the caller's uid (and may not land on an existing
 * object), and only that uploader may later resolve, replace or delete it. Every client put
 * into those folders therefore goes through here — a put without the metadata is refused by the
 * rules. See "Storage rules" in CLAUDE.md.
 */

export const UPLOADER_METADATA_KEY = 'uploaderId'

export const ATTACHMENT_UPLOAD_FOLDERS = ['feedAttachments', 'notesAttachments']

export function buildAttachmentUploadMetadata(uploaderId) {
    if (!uploaderId) throw new Error('An attachment upload needs the uploader uid')
    return { customMetadata: { [UPLOADER_METADATA_KEY]: uploaderId } }
}

/**
 * Puts `file` at `objectPath` in the default bucket as `uploaderId` and returns its download URL.
 * `storageRoot` is the bucket's root reference (`firebase.storage().ref()`).
 */
export async function putAttachmentAsUploader(storageRoot, objectPath, file, uploaderId) {
    const folder = String(objectPath).split('/')[0]
    if (!ATTACHMENT_UPLOAD_FOLDERS.includes(folder)) {
        throw new Error(`Not an attachment upload folder: ${folder}`)
    }
    const attachmentRef = storageRoot.child(objectPath)
    await attachmentRef.put(file, buildAttachmentUploadMetadata(uploaderId))
    return attachmentRef.getDownloadURL()
}
