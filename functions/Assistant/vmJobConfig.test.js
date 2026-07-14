const {
    TARGET_MAX_VM_RUNTIME_MS,
    VM_JOB_WORKER_TIMEOUT_SECONDS,
    VM_JOB_FINALIZATION_HEADROOM_MS,
    MAX_VM_RUNTIME_MS,
    E2B_SANDBOX_TIMEOUT_MS,
} = require('./vmJobConfig')

describe('VM job runtime configuration', () => {
    test('keeps the 55-minute product target explicit', () => {
        expect(TARGET_MAX_VM_RUNTIME_MS).toBe(55 * 60 * 1000)
    })

    test('uses the maximum safe runtime under the Cloud Tasks deadline', () => {
        expect(VM_JOB_WORKER_TIMEOUT_SECONDS).toBe(30 * 60)
        expect(VM_JOB_FINALIZATION_HEADROOM_MS).toBe(5 * 60 * 1000)
        expect(MAX_VM_RUNTIME_MS).toBe(25 * 60 * 1000)
        expect(MAX_VM_RUNTIME_MS + VM_JOB_FINALIZATION_HEADROOM_MS).toBe(VM_JOB_WORKER_TIMEOUT_SECONDS * 1000)
    })

    test('lets the explicit runtime timer win before E2B terminates the sandbox', () => {
        expect(E2B_SANDBOX_TIMEOUT_MS).toBeGreaterThan(MAX_VM_RUNTIME_MS)
        expect(E2B_SANDBOX_TIMEOUT_MS).toBeLessThan(
            VM_JOB_WORKER_TIMEOUT_SECONDS * 1000 - VM_JOB_FINALIZATION_HEADROOM_MS / 2
        )
    })
})
