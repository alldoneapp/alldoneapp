import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { sortArtifactsByLastEdition } from '../../functions/Artifacts/artifactModel'

import {
    watchArtifact,
    watchArtifactVersions,
    watchProjectArtifacts,
    watchProjectUploads,
} from '../../utils/backends/Artifacts/artifactsFirestore'

export function useProjectArtifacts(projectId, followedOnly) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const [state, setState] = useState({ artifacts: [], loaded: false })
    const [uploads, setUploads] = useState([])
    const [uploadsError, setUploadsError] = useState(false)

    useEffect(() => {
        setState({ artifacts: [], loaded: false })
        if (!projectId) return undefined
        return watchProjectArtifacts(
            projectId,
            { followedOnly },
            artifacts => setState({ artifacts, loaded: true }),
            () => setState(current => ({ ...current, loaded: true }))
        )
    }, [projectId, followedOnly, userId])

    useEffect(() => {
        setUploads([])
        setUploadsError(false)
        if (!projectId || followedOnly) return undefined
        return watchProjectUploads(projectId, setUploads, () => setUploadsError(true))
    }, [projectId, followedOnly, userId])

    return { ...state, uploadsError, artifacts: sortArtifactsByLastEdition([...state.artifacts, ...uploads]) }
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
