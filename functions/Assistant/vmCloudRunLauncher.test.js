const mockGetAccessToken = jest.fn(async () => ({ access_token: 'test-token' }))

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({
        options: {
            projectId: 'test-project',
            credential: { getAccessToken: mockGetAccessToken },
        },
    })),
}))

const {
    launchVmCloudRunJob,
    findVmCloudRunExecution,
    cancelVmCloudRunExecution,
    __private__,
} = require('./vmCloudRunLauncher')

function response(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return {
        ok,
        status,
        statusText,
        json: jest.fn(async () => body),
    }
}

describe('vmCloudRunLauncher', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.fetch = jest.fn()
    })

    afterAll(() => {
        delete global.fetch
    })

    test('launches with the correlation override and stores the execution target, not the operation name', async () => {
        const executionName =
            'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/vm-job-runner-abcde'
        fetch.mockResolvedValueOnce(
            response({
                name: 'projects/test-project/locations/europe-west1/operations/operation-1',
                metadata: { target: executionName },
            })
        )

        await expect(launchVmCloudRunJob('correlation-1')).resolves.toEqual({
            executionName,
            operationName: 'projects/test-project/locations/europe-west1/operations/operation-1',
            reconciled: false,
        })
        expect(fetch).toHaveBeenCalledWith(
            'https://run.googleapis.com/v2/projects/test-project/locations/europe-west1/jobs/vm-job-runner:run',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    overrides: {
                        containerOverrides: [{ env: [{ name: 'VM_JOB_CORRELATION_ID', value: 'correlation-1' }] }],
                    },
                }),
            })
        )
    })

    test('reconciles an ambiguous launch response by matching the correlation override', async () => {
        const executionName =
            'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/vm-job-runner-abcde'
        fetch.mockRejectedValueOnce(new Error('socket closed')).mockResolvedValueOnce(
            response({
                executions: [
                    {
                        name: executionName,
                        createTime: new Date().toISOString(),
                        template: {
                            containers: [{ env: [{ name: 'VM_JOB_CORRELATION_ID', value: 'correlation-1' }] }],
                        },
                    },
                ],
            })
        )

        await expect(launchVmCloudRunJob('correlation-1')).resolves.toEqual({
            executionName,
            operationName: null,
            reconciled: true,
        })
    })

    test('retries a transient 5xx launch failure and succeeds on the next attempt', async () => {
        const executionName =
            'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/vm-job-runner-retry'
        fetch
            // attempt 1: :run → 503 (transient)
            .mockResolvedValueOnce(response({}, { ok: false, status: 503, statusText: 'Service Unavailable' }))
            // idempotency lookup before retry → no matching execution yet
            .mockResolvedValueOnce(response({ executions: [] }))
            // attempt 2: :run → success
            .mockResolvedValueOnce(
                response({
                    name: 'projects/test-project/locations/europe-west1/operations/operation-2',
                    metadata: { target: executionName },
                })
            )

        await expect(launchVmCloudRunJob('correlation-1', { sleep: async () => {} })).resolves.toEqual({
            executionName,
            operationName: 'projects/test-project/locations/europe-west1/operations/operation-2',
            reconciled: false,
        })
        const runCalls = fetch.mock.calls.filter(([url]) => url.endsWith(':run'))
        expect(runCalls).toHaveLength(2)
    })

    test('adopts an execution created by a lost attempt instead of launching a duplicate', async () => {
        const executionName =
            'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/vm-job-runner-adopt'
        fetch
            // attempt 1: :run → 503 (transient)
            .mockResolvedValueOnce(response({}, { ok: false, status: 503, statusText: 'Service Unavailable' }))
            // idempotency lookup finds the execution the lost attempt actually created
            .mockResolvedValueOnce(
                response({
                    executions: [
                        {
                            name: executionName,
                            createTime: new Date().toISOString(),
                            template: {
                                containers: [{ env: [{ name: 'VM_JOB_CORRELATION_ID', value: 'correlation-1' }] }],
                            },
                        },
                    ],
                })
            )

        await expect(launchVmCloudRunJob('correlation-1', { sleep: async () => {} })).resolves.toEqual({
            executionName,
            operationName: null,
            reconciled: true,
        })
        // No second :run — the existing execution was adopted, not duplicated.
        const runCalls = fetch.mock.calls.filter(([url]) => url.endsWith(':run'))
        expect(runCalls).toHaveLength(1)
    })

    test('defers to the reconciler after exhausting retries with no execution found', async () => {
        fetch
            // attempt 1: :run → 503
            .mockResolvedValueOnce(response({}, { ok: false, status: 503, statusText: 'Service Unavailable' }))
            // idempotency lookup before retry → nothing
            .mockResolvedValueOnce(response({ executions: [] }))
            // attempt 2: :run → 503
            .mockResolvedValueOnce(response({}, { ok: false, status: 503, statusText: 'Service Unavailable' }))
            // final idempotency lookup → still nothing
            .mockResolvedValueOnce(response({ executions: [] }))

        await expect(
            launchVmCloudRunJob('correlation-1', { sleep: async () => {}, maxAttempts: 2 })
        ).rejects.toMatchObject({ name: 'VmCloudRunLaunchError', ambiguous: true, code: 'cloud_run_launch_unknown' })
        const runCalls = fetch.mock.calls.filter(([url]) => url.endsWith(':run'))
        expect(runCalls).toHaveLength(2)
    })

    test('fails fast without retrying on a non-retryable status', async () => {
        fetch.mockResolvedValueOnce(
            response({ error: { message: 'Permission denied' } }, { ok: false, status: 403, statusText: 'Forbidden' })
        )

        await expect(launchVmCloudRunJob('correlation-1', { sleep: async () => {} })).rejects.toMatchObject({
            name: 'VmCloudRunLaunchError',
            ambiguous: false,
            code: 'cloud_run_launch_failed',
        })
        const runCalls = fetch.mock.calls.filter(([url]) => url.endsWith(':run'))
        expect(runCalls).toHaveLength(1)
    })

    test('lists executions newest-first and finds the matching override', async () => {
        const matching = {
            name: 'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/matching',
            template: {
                containers: [{ env: [{ name: 'VM_JOB_CORRELATION_ID', value: 'correlation-1' }] }],
            },
        }
        fetch.mockResolvedValueOnce(response({ executions: [matching] }))

        await expect(findVmCloudRunExecution('correlation-1')).resolves.toBe(matching)
        expect(fetch.mock.calls[0][0]).toContain('/executions?pageSize=100')
    })

    test('cancels a fully-qualified execution directly', async () => {
        const executionName =
            'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/vm-job-runner-abcde'
        fetch.mockResolvedValueOnce(response({ name: 'cancel-operation' }))

        await expect(cancelVmCloudRunExecution(executionName)).resolves.toEqual({ name: 'cancel-operation' })
        expect(fetch).toHaveBeenCalledWith(
            `https://run.googleapis.com/v2/${executionName}:cancel`,
            expect.objectContaining({ method: 'POST', body: '{}' })
        )
    })

    test('extracts only execution resource names from operation metadata', () => {
        expect(
            __private__.extractExecutionName({
                name: 'projects/test-project/locations/europe-west1/operations/operation-1',
                metadata: {
                    target: 'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/execution-1',
                },
            })
        ).toContain('/executions/execution-1')
    })
})
