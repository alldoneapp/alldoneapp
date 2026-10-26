import { useEffect, useState } from 'react'

import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'

// Which artifact is open per project, and whether the list shows followed or all artifacts.
// Deliberately not redux, like the wiki's selected page: it concerns one view, and a slice written
// on every open would re-render every store subscriber for it (AT-2336). The URL trigger writes it,
// the view reads and writes it.

export const ARTIFACT_SECTION_ARTIFACT = 'artifact'
export const ARTIFACT_SECTION_CHAT = 'chat'
export const ARTIFACT_SECTION_UPDATES = 'updates'
// Everything about the artifact that is not the artifact itself: title, description, visibility,
// live data, versions, links and deletion (AT-2879 moved them out from under the preview).
export const ARTIFACT_SECTION_DETAILS = 'details'
const NON_DEFAULT_SECTIONS = [ARTIFACT_SECTION_CHAT, ARTIFACT_SECTION_UPDATES, ARTIFACT_SECTION_DETAILS]

const selectedArtifactByProject = new Map()
const selectionListeners = new Set()
// Which part of the open artifact is shown: the artifact itself, its chat, its updates or its details.
const sectionByProject = new Map()
const sectionListeners = new Set()
// All by default: a member follows an artifact only by creating it or commenting on it, so Followed
// starts out short.
let activeTab = ALL_TAB
const tabListeners = new Set()

export function getSelectedArtifactId(projectId) {
    return selectedArtifactByProject.get(projectId) || null
}

// Opening another artifact (or none) shows it from the top, unless the caller names the section.
export function setSelectedArtifactId(projectId, artifactId, section = ARTIFACT_SECTION_ARTIFACT) {
    if (!projectId) return
    const next = artifactId || null
    setArtifactSection(projectId, next ? section : ARTIFACT_SECTION_ARTIFACT)
    if (getSelectedArtifactId(projectId) === next) return
    if (next) selectedArtifactByProject.set(projectId, next)
    else selectedArtifactByProject.delete(projectId)
    selectionListeners.forEach(listener => listener(projectId, next))
}

export function getArtifactSection(projectId) {
    return sectionByProject.get(projectId) || ARTIFACT_SECTION_ARTIFACT
}

export function setArtifactSection(projectId, section) {
    if (!projectId) return
    const next = NON_DEFAULT_SECTIONS.includes(section) ? section : ARTIFACT_SECTION_ARTIFACT
    if (getArtifactSection(projectId) === next) return
    if (next !== ARTIFACT_SECTION_ARTIFACT) sectionByProject.set(projectId, next)
    else sectionByProject.delete(projectId)
    sectionListeners.forEach(listener => listener(projectId, next))
}

export function useArtifactSection(projectId) {
    const [section, setSection] = useState(() => getArtifactSection(projectId))

    useEffect(() => {
        setSection(getArtifactSection(projectId))
        const listener = (changedProjectId, nextSection) => {
            if (changedProjectId === projectId) setSection(nextSection)
        }
        sectionListeners.add(listener)
        return () => sectionListeners.delete(listener)
    }, [projectId])

    return [section, nextSection => setArtifactSection(projectId, nextSection)]
}

export function useSelectedArtifactId(projectId) {
    const [artifactId, setArtifactId] = useState(() => getSelectedArtifactId(projectId))

    useEffect(() => {
        setArtifactId(getSelectedArtifactId(projectId))
        const listener = (changedProjectId, nextArtifactId) => {
            if (changedProjectId === projectId) setArtifactId(nextArtifactId)
        }
        selectionListeners.add(listener)
        return () => selectionListeners.delete(listener)
    }, [projectId])

    return [artifactId, nextArtifactId => setSelectedArtifactId(projectId, nextArtifactId)]
}

export function getArtifactsActiveTab() {
    return activeTab
}

export function setArtifactsActiveTab(tab) {
    if (tab === activeTab) return
    activeTab = tab
    tabListeners.forEach(listener => listener(tab))
}

export function useArtifactsActiveTab() {
    const [tab, setTab] = useState(activeTab)

    useEffect(() => {
        setTab(activeTab)
        tabListeners.add(setTab)
        return () => tabListeners.delete(setTab)
    }, [])

    return [tab, setArtifactsActiveTab]
}
