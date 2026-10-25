import { useEffect, useState } from 'react'

import { translate } from '../../i18n/TranslationService'

// Where an artifact is seen in context: the objects a linked upload was uploaded into (a note, a
// task, a comment in a chat…), or the conversation an assistant or a VM run created the artifact in.

const CONTEXT_ICONS = {
    tasks: 'check-square',
    notes: 'file-text',
    goals: 'target',
    contacts: 'user',
    users: 'user',
    skills: 'star',
    topics: 'message-circle',
    assistants: 'cpu',
    artifacts: 'package',
    okrs: 'trending-up',
}

const CONTEXT_TYPE_LABELS = {
    tasks: 'Task',
    notes: 'Note',
    goals: 'Goal',
    contacts: 'Contact',
    users: 'Contact',
    skills: 'Skill',
    topics: 'Chat',
    assistants: 'Assistant',
    artifacts: 'Artifact',
    okrs: 'OKRs',
}

export function getContextIcon(type) {
    return CONTEXT_ICONS[type] || 'link'
}

export function getArtifactContextSources(artifact) {
    if (!artifact) return []
    if (artifact.linkedUpload) return Array.isArray(artifact.linkedSources) ? artifact.linkedSources : []
    const parent = artifact.parentObject
    if (!parent?.type || !parent?.id) return []
    return [{ type: parent.type, id: parent.id, projectId: parent.projectId || null, inThread: true }]
}

// Titles of the objects artifacts were made in, read once per session: a parent's title is not
// stored on the artifact, because it changes with the parent.
const titleReads = new Map()
const titles = new Map()

function readContextTitle(projectId, source) {
    const key = `${projectId}/${source.type}/${source.id}`
    if (!titleReads.has(key)) {
        titleReads.set(
            key,
            new Promise(resolve => {
                // Required on use: the backend module reaches much of the app.
                const { getArtifactContextTitle } = require('../../utils/backends/Artifacts/artifactsFirestore')
                resolve(getArtifactContextTitle(projectId, source))
            })
                .catch(() => '')
                .then(title => {
                    titles.set(key, title)
                    return title
                })
        )
    }
    return titleReads.get(key)
}

export function resetArtifactContextTitlesForTests() {
    titleReads.clear()
    titles.clear()
}

// `{ source, label }` for the artifact's first context, or null when it has none the viewer may open.
// A linked upload names its sources itself; an artifact's parent is read, and stays unlinked when
// the viewer cannot see it.
export function useArtifactContext(projectId, artifact) {
    const sources = getArtifactContextSources(artifact)
    const first = sources[0] || null
    const contextProjectId = first?.projectId || projectId
    const titleKey = first && !artifact.linkedUpload ? `${contextProjectId}/${first.type}/${first.id}` : null
    const [title, setTitle] = useState(() => (titleKey ? titles.get(titleKey) : undefined))

    useEffect(() => {
        if (!titleKey) return undefined
        let active = true
        setTitle(titles.get(titleKey))
        readContextTitle(contextProjectId, first).then(value => {
            if (active) setTitle(value)
        })
        return () => {
            active = false
        }
    }, [titleKey])

    if (!first || !contextProjectId) return null
    const source = { ...first, projectId: contextProjectId }
    const typeLabel = translate(CONTEXT_TYPE_LABELS[first.type] || 'Artifact')
    if (artifact.linkedUpload) {
        const more = sources.length > 1 ? ` +${sources.length - 1}` : ''
        return { source, label: `${translate('Artifact upload in', { title: first.title || typeLabel })}${more}` }
    }
    if (title === null) return null
    return { source, label: translate('Artifact created in', { title: title || typeLabel }) }
}
