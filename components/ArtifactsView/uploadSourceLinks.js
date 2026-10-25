import { getUploadSourcePath } from '../../utils/backends/Artifacts/linkedUploads'

// Opens a source where it is seen in context. A source may name its own project (an artifact's
// parent can live in another project than the artifact).
export function openUploadSource(projectId, source) {
    const URLTrigger = require('../../URLSystem/URLTrigger').default
    const NavigationService = require('../../utils/NavigationService').default
    URLTrigger.processUrl(NavigationService, getUploadSourcePath(source.projectId || projectId, source))
}
