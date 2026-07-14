const admin = require('firebase-admin')

const DEFAULT_REGION = 'europe-west1'
const DEFAULT_JOB_NAME = 'vm-job-runner'

function resolveProjectId() {
    return (
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        admin.app().options.projectId
    )
}

async function launchVmCloudRunJob(correlationId, options = {}) {
    if (!correlationId) throw new Error('correlationId is required')

    const projectId = options.projectId || resolveProjectId()
    const region = options.region || process.env.VM_CLOUD_RUN_JOB_REGION || DEFAULT_REGION
    const jobName = options.jobName || process.env.VM_CLOUD_RUN_JOB_NAME || DEFAULT_JOB_NAME
    if (!projectId) throw new Error('Could not resolve the Google Cloud project for the VM job')

    // Use firebase-admin's configured credential intentionally. This repository
    // initializes it with the Firebase Admin SDK service-account certificate, so
    // job-scoped roles/run.developer must be granted to that account because the
    // correlation id is supplied as an execution override (see deployment docs).
    const credential = admin.app().options.credential
    if (!credential || typeof credential.getAccessToken !== 'function') {
        throw new Error('Firebase Admin credential cannot mint a Cloud Run access token')
    }
    const token = await credential.getAccessToken()
    const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(
        projectId
    )}/locations/${encodeURIComponent(region)}/jobs/${encodeURIComponent(jobName)}:run`
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token.access_token}`,
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
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        const detail = body?.error?.message || `${response.status} ${response.statusText}`
        throw new Error(`Cloud Run Job launch failed: ${detail}`)
    }
    return body
}

module.exports = {
    launchVmCloudRunJob,
    __private__: { resolveProjectId },
}
