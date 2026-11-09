'use strict'

/**
 * An assistant's picture, for both surfaces (CLAUDE.md, "MCP and assistant tools offer the same
 * features"): MCP's `update_assistant` / `create_assistant` and the assistant tool
 * `update_assistant_settings` take the same inputs and store the picture here.
 *
 * Two sources: `photoUrl`, a public image URL (an image uploaded into a chat is one, its download URL
 * is public), and `photoArtifactId`, an image artifact the user can read (e.g. one a VM job made; the
 * artifact tools themselves write text only). Either way the server downloads the bytes, checks that
 * they ARE a raster image (magic bytes, never the URL or a header; SVG is refused because it can carry
 * script) and stores its own public copy where the app's avatar upload stores it, so the picture does
 * not change or vanish with its source. `photoUrl: ""` removes the picture.
 *
 * The app writes three sizes (photoURL, photoURL50, photoURL300) from a cropped upload; the server has
 * no image library, so all three get the one stored copy, as for contact photos. That is why the size
 * limit is lower than for contacts: the 50px avatar loads the same file.
 *
 * Two steps, so a caller can validate before it spends quota and store only once it commits:
 * `prepareAssistantPhoto` downloads and checks, `storeAssistantPhoto` uploads and returns the fields.
 */

const MAX_ASSISTANT_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_FIELDS = ['photoURL', 'photoURL50', 'photoURL300']

const ASSISTANT_PHOTO_SCHEMA_PROPERTIES = {
    photoUrl: {
        type: 'string',
        description:
            'Optional new picture: a public https URL of a JPEG, PNG, GIF or WebP image (at most 5 MB; shown as a circle, so a square image looks best). A copy is stored, so the source may change later. An empty string removes the picture.',
    },
    photoArtifactId: {
        type: 'string',
        description:
            'Optional new picture from an image artifact the user can read (get_artifacts), e.g. one a VM job produced: its current version is used. Not together with photoUrl.',
    },
    photoArtifactProjectId: {
        type: 'string',
        description: "Optional: the project of photoArtifactId, if it is not the assistant's project.",
    },
    photoArtifactPath: {
        type: 'string',
        description: "Optional: the image file inside the artifact; defaults to the artifact's main file.",
    },
}
const ASSISTANT_PHOTO_INPUT_FIELDS = Object.keys(ASSISTANT_PHOTO_SCHEMA_PROPERTIES)

class AssistantPhotoError extends Error {}

const fail = message => {
    throw new AssistantPhotoError(message)
}

const isGiven = value => value !== undefined && value !== null

/** Whether the input asks for a picture change (an empty photoUrl is one: it removes the picture). */
function hasAssistantPhotoInput(input = {}) {
    return isGiven(input.photoUrl) || (isGiven(input.photoArtifactId) && input.photoArtifactId !== '')
}

const hasPhoto = assistant => PHOTO_FIELDS.some(field => assistant && assistant[field])

function checkPublicUrl(value) {
    let url
    try {
        url = new URL(value)
    } catch (error) {
        fail('photoUrl must be a full https:// URL of an image.')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('photoUrl must be an https:// URL of an image.')
}

/**
 * Validates the picture input and fetches the image. Returns null when the input asks for nothing,
 * `{ remove: true }` to remove the picture, `{ unchanged: true }` when there is nothing to remove, or
 * `{ buffer, contentType, source }`.
 */
async function prepareAssistantPhoto({ input = {}, projectId, userId, current = {}, deps = {} }) {
    if (!hasAssistantPhotoInput(input)) return null
    const artifactId = isGiven(input.photoArtifactId) ? input.photoArtifactId : ''
    if (isGiven(input.photoUrl) && artifactId) fail('Pass either photoUrl or photoArtifactId, not both.')

    if (isGiven(input.photoUrl)) {
        if (typeof input.photoUrl !== 'string') fail('photoUrl must be a string.')
        const photoUrl = input.photoUrl.trim()
        if (!photoUrl) return hasPhoto(current) ? { remove: true } : { unchanged: true }
        checkPublicUrl(photoUrl)
        const { downloadImage } = require('../shared/contactPhotoUpload')
        try {
            const image = await (deps.downloadImage || downloadImage)(photoUrl, {
                maxBytes: MAX_ASSISTANT_PHOTO_BYTES,
                ...(deps.downloadOptions || {}),
            })
            return { buffer: image.buffer, contentType: image.contentType, source: { photoUrl } }
        } catch (error) {
            fail(error.message)
        }
    }

    if (typeof artifactId !== 'string') fail('photoArtifactId must be a string.')
    const artifactProjectId = isGiven(input.photoArtifactProjectId)
        ? String(input.photoArtifactProjectId).trim()
        : projectId
    const readArtifactFileForUser =
        deps.readArtifactFileForUser || require('../Artifacts/artifactAssistant').readArtifactFileForUser
    let file
    try {
        file = await readArtifactFileForUser({
            db: deps.db || require('firebase-admin').firestore(),
            bucket: deps.bucket || require('firebase-admin').storage().bucket(),
            projectId: artifactProjectId,
            artifactId: artifactId.trim(),
            userId,
            path: isGiven(input.photoArtifactPath) ? String(input.photoArtifactPath) : undefined,
            maxBytes: MAX_ASSISTANT_PHOTO_BYTES,
            tooLargeMessage: 'The image is larger than 5 MB.',
        })
    } catch (error) {
        fail(error.message)
    }
    const { sniffImageType } = require('../shared/contactPhotoUpload')
    const contentType = sniffImageType(file.bytes)
    if (!contentType) fail(`The artifact file ${file.path} is not a JPEG, PNG, GIF or WebP image.`)
    return {
        buffer: file.bytes,
        contentType,
        source: {
            photoArtifactId: file.artifactId,
            photoArtifactProjectId: artifactProjectId,
            path: file.path,
            versionNumber: file.versionNumber,
        },
    }
}

/**
 * The fields to write for a prepared picture (uploading it first), or null when nothing changes.
 * Stored at the path the app's avatar upload uses: assistants/{projectId}/{assistantId}/.
 */
async function storeAssistantPhoto({ prepared, projectId, assistantId, now = Date.now(), deps = {} }) {
    if (!prepared || prepared.unchanged) return null
    if (prepared.remove) {
        return { fields: { photoURL: '', photoURL50: '', photoURL300: '' }, changed: 'photo removed', photoUrl: '' }
    }
    if (!projectId || !assistantId || String(assistantId).includes('/')) fail('No assistant to store the picture for.')
    const { storePublicImage } = require('../shared/contactPhotoUpload')
    const url = await (deps.storePublicImage || storePublicImage)({
        buffer: prepared.buffer,
        contentType: prepared.contentType,
        filePath: `assistants/${projectId}/${assistantId}/${assistantId}@${now}`,
        ...(deps.bucket ? { bucket: deps.bucket } : {}),
    })
    return { fields: { photoURL: url, photoURL50: url, photoURL300: url }, changed: 'photo', photoUrl: url }
}

module.exports = {
    ASSISTANT_PHOTO_INPUT_FIELDS,
    ASSISTANT_PHOTO_SCHEMA_PROPERTIES,
    AssistantPhotoError,
    MAX_ASSISTANT_PHOTO_BYTES,
    hasAssistantPhotoInput,
    prepareAssistantPhoto,
    storeAssistantPhoto,
}
