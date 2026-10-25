// Offline cancellation: exercise the real button and duplicate-request registry.
export const cancelAssistantRun = async request => {
    window.__cancelRequests ||= []
    window.__cancelRequests.push(request)
}
