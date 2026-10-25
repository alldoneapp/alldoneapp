import { withAnnaMode } from '../utils/annaMode'

// Change the URL before the title: Chromium can otherwise save the destination
// title against the URL we are leaving (AT-2719). Repeated mount writes on a
// direct load or Back/Forward must refresh the entry without losing Forward.
export const writeBrowserHistory = (method, data, urlPath, updateTitle) => {
    const url = withAnnaMode(`${window.location.origin}/${urlPath}`)
    const operation = method === 'push' && url === window.location.href ? 'replaceState' : `${method}State`
    window.history[operation](data, '', url)
    return updateTitle()
}
