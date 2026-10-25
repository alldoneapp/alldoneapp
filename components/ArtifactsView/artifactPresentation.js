import moment from 'moment'

import { ARTIFACT_KINDS, ARTIFACT_SOURCES } from '../../functions/Artifacts/artifactModel'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

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
