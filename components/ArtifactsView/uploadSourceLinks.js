import { getUploadSourcePath } from '../../utils/backends/Artifacts/linkedUploads'

export function openUploadSource(projectId, source) {
    const URLTrigger = require('../../URLSystem/URLTrigger').default
    const NavigationService = require('../../utils/NavigationService').default
    URLTrigger.processUrl(NavigationService, getUploadSourcePath(projectId, source))
}
