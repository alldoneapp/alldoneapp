const archiveRequestsInFlight = new Map()
const ARCHIVE_RETRY_DELAY_MS = 500

const getArchiveRequestKey = archiveData => {
    const messageIds = [...new Set(archiveData.messageIds)].sort()
    return `${archiveData.connectionProjectId}:${messageIds.join('|')}`
}

const isTransientArchiveError = error => {
    const description = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
    return (
        description.includes('unavailable') ||
        description.includes('deadline-exceeded') ||
        description.includes('internal') ||
        description.includes('resource-exhausted') ||
        description.includes('network')
    )
}

const wait = duration => new Promise(resolve => setTimeout(resolve, duration))

const runArchiveRequest = async (archiveData, archiveEmailAction) => {
    const payload = {
        action: 'archive',
        messageIds: [...new Set(archiveData.messageIds)],
    }

    try {
        return await archiveEmailAction(archiveData.connectionProjectId, payload)
    } catch (error) {
        if (!isTransientArchiveError(error)) throw error
        await wait(ARCHIVE_RETRY_DELAY_MS)
        return archiveEmailAction(archiveData.connectionProjectId, payload)
    }
}

const archiveEmailInBackground = (archiveData, archiveEmailAction) => {
    const requestKey = getArchiveRequestKey(archiveData)
    const existingRequest = archiveRequestsInFlight.get(requestKey)
    if (existingRequest) return existingRequest

    const request = runArchiveRequest(archiveData, archiveEmailAction)
    archiveRequestsInFlight.set(requestKey, request)
    request.then(
        () => {
            if (archiveRequestsInFlight.get(requestKey) === request) archiveRequestsInFlight.delete(requestKey)
        },
        () => {
            if (archiveRequestsInFlight.get(requestKey) === request) archiveRequestsInFlight.delete(requestKey)
        }
    )
    return request
}

export function completeEmailLinkedTask({ archiveEmail, archiveData, archiveEmailAction, completeTask }) {
    // Completing the task closes the choice popup and starts its optimistic UI transition.
    // Gmail can be slow (and performEmailLineAction also refreshes the email summary), so it
    // must not sit on the interaction's critical path.
    completeTask()

    return archiveEmail ? archiveEmailInBackground(archiveData, archiveEmailAction) : Promise.resolve()
}
