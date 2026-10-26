import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { sortArtifactsByLastEdition } from '../../functions/Artifacts/artifactModel'

import {
    watchArtifact,
    watchArtifactVersions,
    watchProjectArtifacts,
    watchProjectUploads,
} from '../../utils/backends/Artifacts/artifactsFirestore'
import {
    getArtifactsListCacheKey,
    getLinkedUploadsCacheKey,
    loadCachedValue,
    readCachedValue,
    writeCachedValue,
} from '../../utils/backends/Artifacts/artifactsLocalCache'

function rememberedList(key) {
    const list = key ? readCachedValue(key) : undefined
    return Array.isArray(list) ? list : null
}

function initialArtifactsState(key) {
    const remembered = rememberedList(key)
    return { key, artifacts: remembered || [], loaded: !!remembered }
}

function initialUploadsState(key) {
    return { key, uploads: rememberedList(key) || [] }
}

// While the live files are still being gathered, the remembered ones stay as they are and only files
// the live view has newly found are added; the settled live list then replaces them all.
export function withRememberedFiles(remembered, live) {
    const ids = new Set(remembered.map(file => file.id))
    return [...remembered, ...live.filter(file => !ids.has(file.id))]
}

// The list opens with what this device showed last time and the listeners then update it
// (artifactsLocalCache.js), like the Notes lists. Real artifacts come from one query, whose first
// snapshot replaces the remembered list. Linked uploads are assembled from many listeners and note
// bodies, so the remembered files stay until that has settled instead of the list growing file by
// file. A result that saw a listener fail is shown but not remembered.
export function useProjectArtifacts(projectId, followedOnly) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const listKey = userId && projectId ? getArtifactsListCacheKey(userId, projectId, followedOnly) : null
    const uploadsKey = userId && projectId && !followedOnly ? getLinkedUploadsCacheKey(userId, projectId) : null
    const [state, setState] = useState(() => initialArtifactsState(listKey))
    const [uploadState, setUploadState] = useState(() => initialUploadsState(uploadsKey))
    const [uploadsError, setUploadsError] = useState(false)

    useEffect(() => {
        let active = true
        let live = false
        setState(current => (current.key === listKey ? current : initialArtifactsState(listKey)))
        if (!projectId) return undefined
        if (listKey && !rememberedList(listKey))
            loadCachedValue(listKey).then(list => {
                if (active && !live && Array.isArray(list)) setState({ key: listKey, artifacts: list, loaded: true })
            })
        const unsubscribe = watchProjectArtifacts(
            projectId,
            { followedOnly },
            artifacts => {
                live = true
                setState({ key: listKey, artifacts, loaded: true })
                if (listKey) writeCachedValue(listKey, artifacts)
            },
            () => {
                // A remembered list this session never confirmed is not shown after a failure.
                if (!live) setState({ key: listKey, artifacts: [], loaded: true })
                live = true
            }
        )
        return () => {
            active = false
            unsubscribe()
        }
    }, [projectId, followedOnly, userId])

    useEffect(() => {
        let active = true
        let settled = false
        let failed = false
        let remembered = rememberedList(uploadsKey)
        let live = []
        const show = () =>
            setUploadState({
                key: uploadsKey,
                uploads: settled || !remembered ? live : withRememberedFiles(remembered, live),
            })
        setUploadState(current => (current.key === uploadsKey ? current : initialUploadsState(uploadsKey)))
        setUploadsError(false)
        if (!projectId || followedOnly) return undefined
        if (uploadsKey && !remembered)
            loadCachedValue(uploadsKey).then(list => {
                if (!active || settled || !Array.isArray(list)) return
                remembered = list
                show()
            })
        const unsubscribe = watchProjectUploads(
            projectId,
            (files, meta) => {
                live = files
                if (meta?.settled) settled = true
                show()
                if (settled && !failed && uploadsKey) writeCachedValue(uploadsKey, files)
            },
            () => {
                failed = true
                setUploadsError(true)
            }
        )
        return () => {
            active = false
            unsubscribe()
        }
    }, [projectId, followedOnly, userId])

    const artifacts = useMemo(
        () => sortArtifactsByLastEdition([...state.artifacts, ...uploadState.uploads]),
        [state.artifacts, uploadState.uploads]
    )
    return { artifacts, loaded: state.loaded, uploadsError }
}

// `undefined` while the first snapshot is pending, `null` when the artifact does not exist.
export function useArtifact(projectId, artifactId) {
    const [artifact, setArtifact] = useState(undefined)

    useEffect(() => {
        setArtifact(undefined)
        if (!projectId || !artifactId) return undefined
        return watchArtifact(projectId, artifactId, setArtifact)
    }, [projectId, artifactId])

    return artifact
}

export function useArtifactVersions(projectId, artifactId) {
    const [versions, setVersions] = useState([])

    useEffect(() => {
        setVersions([])
        if (!projectId || !artifactId) return undefined
        return watchArtifactVersions(projectId, artifactId, setVersions)
    }, [projectId, artifactId])

    return versions
}
