// Keep admission and worker dispatch aligned: a user may occupy all ten VM
// worker slots, while additional per-user jobs retain the existing rejection behavior.
const MAX_CONCURRENT_VM_JOBS = 10
const MAX_CONCURRENT_VM_JOBS_PER_USER = MAX_CONCURRENT_VM_JOBS

// Product target: allow a VM task to execute for up to 55 minutes. The current
// Firebase task worker is delivered as a Cloud Tasks HTTP task, whose dispatch
// deadline has a hard 30-minute maximum. Keep enough time after the agent stops
// to upload artifacts, settle Gold and publish the result to every channel.
//
// If the worker moves to infrastructure that supports the target (for example a
// Cloud Run Job), this shared calculation automatically raises the effective
// runtime once VM_JOB_WORKER_TIMEOUT_SECONDS is raised as well.
const TARGET_MAX_VM_RUNTIME_MS = 55 * 60 * 1000
const VM_JOB_WORKER_TIMEOUT_SECONDS = 30 * 60
const VM_JOB_FINALIZATION_HEADROOM_MS = 5 * 60 * 1000
const MAX_VM_RUNTIME_MS = Math.min(
    TARGET_MAX_VM_RUNTIME_MS,
    VM_JOB_WORKER_TIMEOUT_SECONDS * 1000 - VM_JOB_FINALIZATION_HEADROOM_MS
)

// Let our typed runtime timer fire before E2B's generic sandbox termination.
// This small grace period is still part of the worker finalization headroom.
const E2B_SANDBOX_TERMINATION_GRACE_MS = 30 * 1000
const E2B_SANDBOX_TIMEOUT_MS = MAX_VM_RUNTIME_MS + E2B_SANDBOX_TERMINATION_GRACE_MS

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
    VM_JOB_WORKER_TIMEOUT_SECONDS,
    VM_JOB_FINALIZATION_HEADROOM_MS,
    MAX_VM_RUNTIME_MS,
    E2B_SANDBOX_TIMEOUT_MS,
}
