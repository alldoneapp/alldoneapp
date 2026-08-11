const admin = require('firebase-admin')

const DEFAULT_REGION = 'europe-west1'
const DEFAULT_JOB_NAME = 'vm-job-runner'
const DEFAULT_RECONCILIATION_PAGE_SIZE = 100
const MAX_RECONCILIATION_PAGES = 5
// Total :run attempts (1 initial + retries) before a transient failure is handed to the reconciler.
const DEFAULT_MAX_LAUNCH_ATTEMPTS = 3
// Backoff before re-issuing :run after a transient failure. The attempt index clamps to the last entry.
const DEFAULT_LAUNCH_BACKOFF_MS = [500, 1500]

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// A launch failed transiently if the network call itself threw or Cloud Run returned a
// retryable status. Any other non-2xx (e.g. 400/403/404) is a definitive, non-retryable failure.
function isTransientLaunchStatus(status) {
    return status === 408 || status === 429 || status >= 500
}

class VmCloudRunLaunchError extends Error {
    constructor(message, { ambiguous = false, cause } = {}) {
        super(message)
        this.name = 'VmCloudRunLaunchError'
        this.code = ambiguous ? 'cloud_run_launch_unknown' : 'cloud_run_launch_failed'
        this.ambiguous = ambiguous
        if (cause) this.cause = cause
    }
}

function resolveProjectId() {
    return (
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        admin.app().options.projectId
    )
}

function resolveCloudRunJob(options = {}) {
    const projectId = options.projectId || resolveProjectId()
    const region = options.region || process.env.VM_CLOUD_RUN_JOB_REGION || DEFAULT_REGION
    const jobName = options.jobName || process.env.VM_CLOUD_RUN_JOB_NAME || DEFAULT_JOB_NAME
    if (!projectId) throw new Error('Could not resolve the Google Cloud project for the VM job')
    const jobResource = `projects/${projectId}/locations/${region}/jobs/${jobName}`
    return {
        projectId,
        region,
        jobName,
        jobResource,
        jobUrl: `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(
            region
        )}/jobs/${encodeURIComponent(jobName)}`,
    }
}

async function getAccessToken(options = {}) {
    // Use firebase-admin's configured credential intentionally. This repository
    // initializes it with the Firebase Admin SDK service-account certificate.
    const credential = options.credential || admin.app().options.credential
    if (!credential || typeof credential.getAccessToken !== 'function') {
        throw new Error('Firebase Admin credential cannot mint a Cloud Run access token')
    }
    const token = await credential.getAccessToken()
    return token.access_token
}

async function readJsonResponse(response) {
    return response.json().catch(() => ({}))
}

function responseError(action, response, body) {
    const detail = body?.error?.message || `${response.status} ${response.statusText}`
    return new Error(`Cloud Run Job ${action} failed: ${detail}`)
}

function getExecutionContainers(execution) {
    return execution?.template?.containers || execution?.template?.template?.containers || []
}

function executionHasCorrelationId(execution, correlationId) {
    return getExecutionContainers(execution).some(container =>
        (container.env || []).some(env => env.name === 'VM_JOB_CORRELATION_ID' && env.value === correlationId)
    )
}

function executionHasAttemptId(execution, executionAttemptId) {
    if (!executionAttemptId) return true
    return getExecutionContainers(execution).some(container =>
        (container.env || []).some(
            env => env.name === 'VM_JOB_EXECUTION_ATTEMPT_ID' && env.value === executionAttemptId
        )
    )
}

function extractExecutionName(operation) {
    const candidates = [operation?.response?.name, operation?.metadata?.target, operation?.metadata?.name]
    return (
        candidates.find(value => typeof value === 'string' && /\/jobs\/[^/]+\/executions\/[^/]+$/.test(value)) || null
    )
}

async function findVmCloudRunExecution(correlationId, options = {}) {
    if (!correlationId) throw new Error('correlationId is required')
    const { jobUrl } = resolveCloudRunJob(options)
    const accessToken = options.accessToken || (await getAccessToken(options))
    let pageToken = ''
    const minCreateTime = Number(options.minCreateTime) || 0
    const executionAttemptId = options.executionAttemptId || ''

    for (let page = 0; page < MAX_RECONCILIATION_PAGES; page += 1) {
        const params = new URLSearchParams({ pageSize: String(DEFAULT_RECONCILIATION_PAGE_SIZE) })
        if (pageToken) params.set('pageToken', pageToken)
        const response = await fetch(`${jobUrl}/executions?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
        const body = await readJsonResponse(response)
        if (!response.ok) throw responseError('execution lookup', response, body)

        for (const execution of body.executions || []) {
            const createTime = Date.parse(execution.createTime || '') || 0
            if (minCreateTime && createTime && createTime < minCreateTime) return null
            if (
                executionHasCorrelationId(execution, correlationId) &&
                executionHasAttemptId(execution, executionAttemptId)
            )
                return execution
        }
        pageToken = body.nextPageToken || ''
        if (!pageToken) break
    }
    return null
}

// A single POST :run attempt. Returns a discriminated result so the retry loop can decide what to
// do without unwinding via exceptions:
//   { kind: 'ok', body }             — execution accepted
//   { kind: 'transient', cause }     — network throw, or a retryable status (408/429/5xx)
//   { kind: 'fatal', error }         — a definitive, non-retryable failure (other non-2xx)
async function attemptVmCloudRunLaunch(jobUrl, correlationId, executionAttemptId, accessToken) {
    let response
    try {
        response = await fetch(`${jobUrl}:run`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                overrides: {
                    containerOverrides: [
                        {
                            env: [
                                { name: 'VM_JOB_CORRELATION_ID', value: correlationId },
                                ...(executionAttemptId
                                    ? [{ name: 'VM_JOB_EXECUTION_ATTEMPT_ID', value: executionAttemptId }]
                                    : []),
                            ],
                        },
                    ],
                },
            }),
        })
    } catch (cause) {
        return { kind: 'transient', cause }
    }
    const body = await readJsonResponse(response)
    if (response.ok) return { kind: 'ok', body }
    if (isTransientLaunchStatus(response.status)) {
        return { kind: 'transient', cause: responseError('launch', response, body) }
    }
    return {
        kind: 'fatal',
        error: new VmCloudRunLaunchError(responseError('launch', response, body).message, { ambiguous: false }),
    }
}

// Launch a Cloud Run Job execution, retrying transient failures inline instead of immediately
// deferring to the (up-to-10-minute) reconciler. Retries are idempotent: before re-issuing :run we
// look for an execution already tagged with this correlation id, so a launch whose HTTP response was
// lost is adopted rather than duplicated. Only after exhausting retries without a confirmable
// execution do we throw ambiguous — leaving the reconciler as the final backstop, unchanged.
async function launchVmCloudRunJob(correlationId, options = {}) {
    if (!correlationId) throw new Error('correlationId is required')
    const { jobUrl } = resolveCloudRunJob(options)
    const accessToken = await getAccessToken(options)
    const launchStartedAt = Date.now()
    const executionAttemptId = options.executionAttemptId || ''
    const maxAttempts = Number(options.maxAttempts) || DEFAULT_MAX_LAUNCH_ATTEMPTS
    const backoffMs = options.backoffMs || DEFAULT_LAUNCH_BACKOFF_MS
    const sleep = options.sleep || defaultSleep

    // Look for an execution a prior attempt may have created (matched by the correlation override).
    const findExisting = () =>
        findVmCloudRunExecution(correlationId, {
            ...options,
            accessToken,
            minCreateTime: launchStartedAt - 60 * 1000,
        }).catch(() => null)

    let lastCause = null
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        // Idempotency guard: never issue a second :run for a correlation id that already launched.
        if (attempt > 0) {
            const existing = await findExisting()
            if (existing) {
                return { executionName: existing.name, operationName: null, reconciled: true }
            }
            const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]
            await sleep(delay)
        }

        const result = await attemptVmCloudRunLaunch(jobUrl, correlationId, executionAttemptId, accessToken)

        if (result.kind === 'ok') {
            let executionName = extractExecutionName(result.body)
            if (!executionName) {
                const execution = await findExisting()
                executionName = execution?.name || null
            }
            return { executionName, operationName: result.body.name || null, reconciled: false }
        }

        if (result.kind === 'fatal') throw result.error

        lastCause = result.cause
    }

    // Exhausted retries on transient failures. One final look in case the last attempt's execution
    // was created but its response lost; otherwise defer to the reconciler exactly as before.
    const existing = await findExisting()
    if (existing) {
        return { executionName: existing.name, operationName: null, reconciled: true }
    }
    throw new VmCloudRunLaunchError('Cloud Run Job launch result is unknown', { ambiguous: true, cause: lastCause })
}

async function cancelVmCloudRunExecution(executionName, options = {}) {
    if (!executionName || !/^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+\/executions\/[^/]+$/.test(executionName)) {
        throw new Error('A fully-qualified Cloud Run execution name is required')
    }
    const accessToken = await getAccessToken(options)
    const response = await fetch(`https://run.googleapis.com/v2/${executionName}:cancel`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: '{}',
    })
    const body = await readJsonResponse(response)
    if (!response.ok) throw responseError('execution cancellation', response, body)
    return body
}

module.exports = {
    VmCloudRunLaunchError,
    launchVmCloudRunJob,
    findVmCloudRunExecution,
    cancelVmCloudRunExecution,
    __private__: {
        resolveProjectId,
        resolveCloudRunJob,
        executionHasCorrelationId,
        executionHasAttemptId,
        extractExecutionName,
    },
}
