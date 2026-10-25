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

// Uploads have source relationships rather than their own follow state or detail URL.
export function openProjectUploads(projectId) {
    const { ALL_TAB } = require('../Feeds/Utils/FeedsConstants')
    const { setArtifactsActiveTab, setSelectedArtifactId } = require('./artifactsNavigationState')
    setArtifactsActiveTab(ALL_TAB)
    setSelectedArtifactId(projectId, null)
    openProjectArtifacts(projectId)
}
