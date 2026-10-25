import moment from 'moment'

import { ARTIFACT_KINDS, ARTIFACT_SOURCES } from '../../functions/Artifacts/artifactModel'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { colors } from '../styles/global'

const KIND_ICONS = {
    [ARTIFACT_KINDS.WEB]: 'globe',
    [ARTIFACT_KINDS.MARKDOWN]: 'file-text',
    [ARTIFACT_KINDS.PDF]: 'file',
    [ARTIFACT_KINDS.IMAGE]: 'image',
    [ARTIFACT_KINDS.VIDEO]: 'film',
    [ARTIFACT_KINDS.AUDIO]: 'music',
    [ARTIFACT_KINDS.DATA]: 'bar-chart-2',
    [ARTIFACT_KINDS.TEXT]: 'file-text',
    [ARTIFACT_KINDS.FILE]: 'paperclip',
}

export function getArtifactKindIcon(kind) {
    return KIND_ICONS[kind] || KIND_ICONS[ARTIFACT_KINDS.FILE]
}

// The tile behind a row's icon, so a list can be scanned by kind before it is read. Text kinds stay
// neutral; only the kinds people look for by sight get a colour.
const NEUTRAL_TINT = { background: colors.Grey200, icon: colors.Text02 }
const KIND_TINTS = {
    [ARTIFACT_KINDS.WEB]: { background: colors.UtilityBlue100, icon: colors.UtilityBlue300 },
    [ARTIFACT_KINDS.PDF]: { background: colors.UtilityRed100, icon: colors.UtilityRed300 },
    [ARTIFACT_KINDS.IMAGE]: { background: colors.UtilityViolet100, icon: colors.UtilityViolet300 },
    [ARTIFACT_KINDS.VIDEO]: { background: colors.UtilityViolet100, icon: colors.UtilityViolet300 },
    [ARTIFACT_KINDS.AUDIO]: { background: colors.UtilityOrange100, icon: colors.UtilityOrange300 },
    [ARTIFACT_KINDS.DATA]: { background: colors.UtilityGreen100, icon: colors.UtilityGreen300 },
}

export function getArtifactKindTint(kind) {
    return KIND_TINTS[kind] || NEUTRAL_TINT
}

// What a row draws instead of its icon. An image shows itself (a linked upload's stored 300px copy
// when the source has one, otherwise the file), a linked video its first frame. Everything else,
// and a full artifact's video, keeps its icon: a frame of a page would mean running the page, and
// a video behind serveArtifact cannot be range-read for one frame.
export function getArtifactThumbnail(artifact, getServeUrl) {
    if (!artifact) return null
    if (artifact.linkedUpload) {
        if (!artifact.url) return null
        if (artifact.kind === ARTIFACT_KINDS.IMAGE) return { type: 'image', url: artifact.thumbnailUrl || artifact.url }
        if (artifact.kind === ARTIFACT_KINDS.VIDEO) return { type: 'video', url: artifact.url }
        return null
    }
    if (artifact.kind !== ARTIFACT_KINDS.IMAGE || typeof getServeUrl !== 'function') return null
    const url = getServeUrl(artifact)
    return url ? { type: 'image', url } : null
}

// A linked upload opens in the app's own viewer straight from the address its source embeds. Only
// media the browser renders without running anything (img, video, audio) is shown inline. A PDF or
// any other file is offered in a new tab instead: Chrome renders a PDF only in an unsandboxed frame,
// and a stored file's content type is whatever the uploader's browser declared, so such a frame
// could run a disguised page's script on top of the app.
const LINKED_INLINE_KINDS = new Set([ARTIFACT_KINDS.IMAGE, ARTIFACT_KINDS.VIDEO, ARTIFACT_KINDS.AUDIO])

export function canShowLinkedUploadInline(artifact) {
    return !!artifact?.linkedUpload && !!artifact.url && LINKED_INLINE_KINDS.has(artifact.kind)
}

// How many rows a project shows before "show more": a glance in All projects, a page in one project.
export const ALL_PROJECTS_ARTIFACTS_PREVIEW = 3
export const PROJECT_ARTIFACTS_PREVIEW = 10

export function limitArtifacts(artifacts, limit, expanded) {
    const list = artifacts || []
    return { visible: expanded ? list : list.slice(0, limit), hasMore: list.length > limit }
}

const SOURCE_LABEL_KEYS = {
    [ARTIFACT_SOURCES.UPLOAD]: 'Artifact source upload',
    [ARTIFACT_SOURCES.ASSISTANT]: 'Artifact source assistant',
    [ARTIFACT_SOURCES.VM]: 'Artifact source vm',
}

export function getArtifactSourceLabelKey(source) {
    return SOURCE_LABEL_KEYS[source] || SOURCE_LABEL_KEYS[ARTIFACT_SOURCES.UPLOAD]
}

export function formatArtifactSize(bytes) {
    const value = Number(bytes) || 0
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function formatArtifactDate(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || !timestamp) return ''
    return moment(Number(timestamp)).format(`${getDateFormat()} ${getTimeFormat()}`)
}

// Kinds the app can show in place. Everything else gets a download card instead.
const PREVIEWABLE_KINDS = new Set([
    ARTIFACT_KINDS.WEB,
    ARTIFACT_KINDS.MARKDOWN,
    ARTIFACT_KINDS.PDF,
    ARTIFACT_KINDS.IMAGE,
    ARTIFACT_KINDS.VIDEO,
    ARTIFACT_KINDS.AUDIO,
    ARTIFACT_KINDS.DATA,
    ARTIFACT_KINDS.TEXT,
])

export function canPreviewArtifact(artifact) {
    return !!artifact && PREVIEWABLE_KINDS.has(artifact.kind)
}

// Text kinds are fetched and rendered by the app rather than framed, so they follow the app's
// typography. Data files beyond a few hundred kilobytes are left to the download.
export const MAX_INLINE_TEXT_BYTES = 512 * 1024

export function isInlineTextArtifact(artifact) {
    return (
        !!artifact &&
        [ARTIFACT_KINDS.MARKDOWN, ARTIFACT_KINDS.TEXT, ARTIFACT_KINDS.DATA].includes(artifact.kind) &&
        artifact.mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
        (Number(artifact.sizeBytes) || 0) <= MAX_INLINE_TEXT_BYTES
    )
}

// The filter chips over a project's artifacts: kinds grouped the way a person looks for them.
export const ARTIFACT_KIND_GROUPS = [
    { key: 'pages', labelKey: 'Artifact kind pages', kinds: [ARTIFACT_KINDS.WEB] },
    {
        key: 'documents',
        labelKey: 'Artifact kind documents',
        kinds: [ARTIFACT_KINDS.MARKDOWN, ARTIFACT_KINDS.PDF, ARTIFACT_KINDS.TEXT],
    },
    {
        key: 'media',
        labelKey: 'Artifact kind media',
        kinds: [ARTIFACT_KINDS.IMAGE, ARTIFACT_KINDS.VIDEO, ARTIFACT_KINDS.AUDIO],
    },
    { key: 'data', labelKey: 'Artifact kind data', kinds: [ARTIFACT_KINDS.DATA] },
    { key: 'files', labelKey: 'Artifact kind files', kinds: [ARTIFACT_KINDS.FILE] },
]

export function getArtifactKindGroupKey(kind) {
    const group = ARTIFACT_KIND_GROUPS.find(candidate => candidate.kinds.includes(kind))
    return group ? group.key : 'files'
}

// The groups present in `artifacts`, in the fixed order. One group alone is no choice at all.
export function getPresentArtifactKindGroups(artifacts) {
    const present = new Set((artifacts || []).map(artifact => getArtifactKindGroupKey(artifact.kind)))
    const groups = ARTIFACT_KIND_GROUPS.filter(group => present.has(group.key))
    return groups.length > 1 ? groups : []
}

export function filterArtifactsByKindGroup(artifacts, groupKey) {
    if (!groupKey) return artifacts
    return artifacts.filter(artifact => getArtifactKindGroupKey(artifact.kind) === groupKey)
}
