const admin = require('firebase-admin')

const DEFAULT_REGION = 'europe-west1'
const DEFAULT_JOB_NAME = 'vm-job-runner'
const DEFAULT_RECONCILIATION_PAGE_SIZE = 100
const MAX_RECONCILIATION_PAGES = 5

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
            if (executionHasCorrelationId(execution, correlationId)) return execution
        }
        pageToken = body.nextPageToken || ''
        if (!pageToken) break
    }
    return null
}

async function launchVmCloudRunJob(correlationId, options = {}) {
    if (!correlationId) throw new Error('correlationId is required')
    const { jobUrl } = resolveCloudRunJob(options)
    const accessToken = await getAccessToken(options)
    const launchStartedAt = Date.now()
    let response
    let body = {}

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
                            env: [{ name: 'VM_JOB_CORRELATION_ID', value: correlationId }],
                        },
                    ],
                },
            }),
        })
        body = await readJsonResponse(response)
    } catch (cause) {
        const execution = await findVmCloudRunExecution(correlationId, {
            ...options,
            accessToken,
            minCreateTime: launchStartedAt - 60 * 1000,
        }).catch(() => null)
        if (execution) {
            return { executionName: execution.name, operationName: null, reconciled: true }
        }
        throw new VmCloudRunLaunchError('Cloud Run Job launch result is unknown', { ambiguous: true, cause })
    }

    if (!response.ok) {
        const ambiguous = response.status === 408 || response.status === 429 || response.status >= 500
        if (ambiguous) {
            const execution = await findVmCloudRunExecution(correlationId, {
                ...options,
                accessToken,
                minCreateTime: launchStartedAt - 60 * 1000,
            }).catch(() => null)
            if (execution) {
                return { executionName: execution.name, operationName: body.name || null, reconciled: true }
            }
        }
        throw new VmCloudRunLaunchError(responseError('launch', response, body).message, { ambiguous })
    }

    let executionName = extractExecutionName(body)
    if (!executionName) {
        const execution = await findVmCloudRunExecution(correlationId, {
            ...options,
            accessToken,
            minCreateTime: launchStartedAt - 60 * 1000,
        }).catch(() => null)
        executionName = execution?.name || null
    }
    return {
        executionName,
        operationName: body.name || null,
        reconciled: false,
    }
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
        extractExecutionName,
    },
}
