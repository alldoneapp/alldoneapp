const originalCloudRunJob = process.env.CLOUD_RUN_JOB
process.env.CLOUD_RUN_JOB = 'vm-job-runner'

const {
    TARGET_MAX_VM_RUNTIME_MS,
    LEGACY_MAX_VM_RUNTIME_MS,
    VM_JOB_WORKER_TIMEOUT_SECONDS,
    VM_JOB_FINALIZATION_HEADROOM_MS,
    VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS,
    MAX_VM_RUNTIME_MS,
    E2B_SANDBOX_TERMINATION_GRACE_MS,
    E2B_SANDBOX_TIMEOUT_MS,
    E2B_SANDBOX_SLICE_MS,
    resolveMaxVmRuntimeMs,
} = require('./vmJobConfig')

describe('VM job runtime configuration', () => {
    test('keeps the five-hour product target explicit', () => {
        expect(TARGET_MAX_VM_RUNTIME_MS).toBe(5 * 60 * 60 * 1000)
        expect(LEGACY_MAX_VM_RUNTIME_MS).toBe(25 * 60 * 1000)
        expect(resolveMaxVmRuntimeMs({ CLOUD_RUN_JOB: 'vm-job-runner' })).toBe(TARGET_MAX_VM_RUNTIME_MS)
        expect(resolveMaxVmRuntimeMs({})).toBe(LEGACY_MAX_VM_RUNTIME_MS)
    })

    test('reserves cleanup time beyond the detached VM runtime', () => {
        expect(VM_JOB_WORKER_TIMEOUT_SECONDS).toBe(30 * 60)
        expect(VM_JOB_FINALIZATION_HEADROOM_MS).toBe(45 * 60 * 1000)
        expect(MAX_VM_RUNTIME_MS).toBe(5 * 60 * 60 * 1000)
        expect(VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS).toBe(5 * 60 * 60 + 45 * 60)
    })

    test('never requests more than the one-hour E2B account limit', () => {
        expect(E2B_SANDBOX_TIMEOUT_MS).toBe(60 * 60 * 1000)
        expect(E2B_SANDBOX_SLICE_MS).toBe(55 * 60 * 1000)
        expect(E2B_SANDBOX_TERMINATION_GRACE_MS).toBe(30 * 1000)
        expect(E2B_SANDBOX_TIMEOUT_MS).toBeLessThan(MAX_VM_RUNTIME_MS)
    })

    afterAll(() => {
        if (originalCloudRunJob === undefined) delete process.env.CLOUD_RUN_JOB
        else process.env.CLOUD_RUN_JOB = originalCloudRunJob
    })
})
