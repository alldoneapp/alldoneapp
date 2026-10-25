import { useEffect, useState } from 'react'

import {
    watchArtifact,
    watchArtifactVersions,
    watchProjectArtifacts,
} from '../../utils/backends/Artifacts/artifactsFirestore'

export function useProjectArtifacts(projectId, followedOnly) {
    const [state, setState] = useState({ artifacts: [], loaded: false })

    useEffect(() => {
        setState({ artifacts: [], loaded: false })
        if (!projectId) return undefined
        return watchProjectArtifacts(
            projectId,
            { followedOnly },
            artifacts => setState({ artifacts, loaded: true }),
            () => setState(current => ({ ...current, loaded: true }))
        )
    }, [projectId, followedOnly])

    return state
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
