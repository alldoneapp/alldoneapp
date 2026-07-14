// Keep the product's per-user admission cap aligned with the retained rollback
// queue. Cloud Run's project-wide concurrency is controlled by regional quota.
const MAX_CONCURRENT_VM_JOBS = 10
const MAX_CONCURRENT_VM_JOBS_PER_USER = MAX_CONCURRENT_VM_JOBS

// The detached Cloud Run Job may supervise E2B for one hour. The Cloud Run
// task itself gets additional time to upload artifacts, settle Gold, notify all
// channels and clean up the sandbox after the product runtime has elapsed.
const TARGET_MAX_VM_RUNTIME_MS = 60 * 60 * 1000
const LEGACY_MAX_VM_RUNTIME_MS = 25 * 60 * 1000
const VM_JOB_WORKER_TIMEOUT_SECONDS = 30 * 60
const VM_JOB_FINALIZATION_HEADROOM_MS = 15 * 60 * 1000
const VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS = (TARGET_MAX_VM_RUNTIME_MS + VM_JOB_FINALIZATION_HEADROOM_MS) / 1000
function resolveMaxVmRuntimeMs(env = process.env) {
    return env.CLOUD_RUN_JOB ? TARGET_MAX_VM_RUNTIME_MS : LEGACY_MAX_VM_RUNTIME_MS
}

// Cloud Run injects CLOUD_RUN_JOB into job containers. The retained Cloud Tasks
// rollback worker keeps its prior 25-minute ceiling so it still finishes within
// the 30-minute task function timeout.
const MAX_VM_RUNTIME_MS = resolveMaxVmRuntimeMs()

// E2B's free tier rejects any sandbox timeout above exactly one hour. The
// runner derives the agent-command budget from this lease and fires its typed
// timeout before E2B's generic sandbox termination.
const E2B_SANDBOX_TERMINATION_GRACE_MS = 30 * 1000
const E2B_SANDBOX_TIMEOUT_MS = MAX_VM_RUNTIME_MS

// E2B's lowest service tier allows one sandbox creation per second. Throttling
// dispatch startup avoids burst rate-limit failures without reducing the number
// of jobs that can remain running concurrently.
const VM_JOB_QUEUE_RATE_LIMITS = Object.freeze({
    maxConcurrentDispatches: MAX_CONCURRENT_VM_JOBS,
    maxDispatchesPerSecond: 1,
})

module.exports = {
    MAX_CONCURRENT_VM_JOBS,
    MAX_CONCURRENT_VM_JOBS_PER_USER,
    VM_JOB_QUEUE_RATE_LIMITS,
    TARGET_MAX_VM_RUNTIME_MS,
    LEGACY_MAX_VM_RUNTIME_MS,
    VM_JOB_WORKER_TIMEOUT_SECONDS,
    VM_JOB_FINALIZATION_HEADROOM_MS,
    VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS,
    MAX_VM_RUNTIME_MS,
    E2B_SANDBOX_TERMINATION_GRACE_MS,
    E2B_SANDBOX_TIMEOUT_MS,
    resolveMaxVmRuntimeMs,
}
