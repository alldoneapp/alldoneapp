'use strict'

// This state belongs to one assistant invocation, never to the process/schema cache. A
// continuation is a new queued job, so retries and status checks must reuse the first dispatch.
async function dispatchVmOnce({ runtime, projectId, requestUserId, args, dispatch }) {
    if (!runtime) return dispatch()
    const jobs = (runtime.vmDispatches ||= new Map())
    const continuation =
        args.continue_in_object_id === 'latest' && runtime.objectId ? runtime.objectId : args.continue_in_object_id
    const target = args.target_task_id || continuation || runtime.objectId || 'new'
    const targetProject = args.target_project_id || projectId
    const scope = runtime.messageId || (runtime.vmDispatchScope ||= runtime.assistantCommentId || 'request')
    const keyFor = (project, object) => JSON.stringify([scope, requestUserId, project, object])
    const key = keyFor(targetProject, target)
    if (jobs.has(key)) {
        const result = await jobs.get(key)
        if (!result?.success || !result.correlationId) return result
        return {
            ...result,
            reused: true,
            message:
                'This request already dispatched this VM job. No new job was queued. ' +
                `Use get_vm_job with correlationId="${result.correlationId}" and waitSeconds=30 to wait for its result. ` +
                'Use the returned artifact references for email attachments; do not launch another VM to check or retrieve the file.',
        }
    }
    const pending = Promise.resolve().then(dispatch)
    jobs.set(key, pending)
    const result = await pending
    // A thrown/uncertain dispatch remains cached and cannot be repeated automatically.
    if (result?.success && result.correlationId) {
        jobs.set(keyFor(targetProject, 'latest'), pending)
        if (result.hostObjectId) jobs.set(keyFor(result.hostProjectId || targetProject, result.hostObjectId), pending)
    } else {
        jobs.delete(key)
    }
    return result
}

module.exports = { dispatchVmOnce }
