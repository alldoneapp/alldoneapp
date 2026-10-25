import NavigationService from '../../utils/NavigationService'

// Required on use: URLTrigger reaches the whole URL system and, through the store, the root views —
// this view among them.
const getURLTrigger = () => require('../../URLSystem/URLTrigger').default

export function getProjectArtifactsPath(projectId, artifactId = null, { chat = false } = {}) {
    if (!artifactId) return `/projects/${projectId}/artifacts`
    return `/projects/${projectId}/artifacts/${artifactId}${chat ? '/chat' : ''}`
}

export function openProjectArtifacts(projectId, artifactId = null, options) {
    if (!projectId) return
    getURLTrigger().processUrl(NavigationService, getProjectArtifactsPath(projectId, artifactId, options))
}
