// Keep admission and worker dispatch aligned: a user may occupy all five VM
// worker slots, while additional per-user jobs retain the existing rejection behavior.
const MAX_CONCURRENT_VM_JOBS = 5
const MAX_CONCURRENT_VM_JOBS_PER_USER = MAX_CONCURRENT_VM_JOBS

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
}
