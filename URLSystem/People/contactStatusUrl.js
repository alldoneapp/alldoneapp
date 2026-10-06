const CONTACTS_PROJECT_PATH = /^\/projects\/([\w-]+)\/user\/[\w-]+\/contacts\/(all|followed)$/
export const CONTACT_STATUS_QUERY_PARAM = 'contactStatus'

export const withContactStatus = (path, statusId) => {
    const url = new URL(path, 'https://alldone.app/')
    if (statusId) url.searchParams.set(CONTACT_STATUS_QUERY_PARAM, statusId)
    else url.searchParams.delete(CONTACT_STATUS_QUERY_PARAM)
    return `${url.pathname.slice(1)}${url.search}${url.hash}`
}

export const readContactStatusFromUrl = (path, projectId) => {
    const url = new URL(path, 'https://alldone.app/')
    const match = url.pathname.match(CONTACTS_PROJECT_PATH)
    if (!match || (projectId && match[1] !== projectId)) return null
    const statusId = url.searchParams.get(CONTACT_STATUS_QUERY_PARAM)
    return statusId && /^[\w-]+$/.test(statusId) ? statusId : null
}
