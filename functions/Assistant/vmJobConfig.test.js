const {
    TARGET_MAX_VM_RUNTIME_MS,
    VM_JOB_WORKER_TIMEOUT_SECONDS,
    VM_JOB_FINALIZATION_HEADROOM_MS,
    VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS,
    MAX_VM_RUNTIME_MS,
    E2B_SANDBOX_TIMEOUT_MS,
} = require('./vmJobConfig')

describe('VM job runtime configuration', () => {
    test('keeps the five-hour product target explicit', () => {
        expect(TARGET_MAX_VM_RUNTIME_MS).toBe(5 * 60 * 60 * 1000)
    })

    test('reserves cleanup time beyond the detached VM runtime', () => {
        expect(VM_JOB_WORKER_TIMEOUT_SECONDS).toBe(30 * 60)
        expect(VM_JOB_FINALIZATION_HEADROOM_MS).toBe(15 * 60 * 1000)
        expect(MAX_VM_RUNTIME_MS).toBe(5 * 60 * 60 * 1000)
        expect(VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS).toBe(5 * 60 * 60 + 15 * 60)
    })

    test('lets the explicit runtime timer win before E2B terminates the sandbox', () => {
        expect(E2B_SANDBOX_TIMEOUT_MS).toBeGreaterThan(MAX_VM_RUNTIME_MS)
        expect(E2B_SANDBOX_TIMEOUT_MS).toBeLessThan(MAX_VM_RUNTIME_MS + VM_JOB_FINALIZATION_HEADROOM_MS)
    })
})
