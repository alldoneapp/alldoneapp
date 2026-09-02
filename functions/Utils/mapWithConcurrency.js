/**
 * Run `fn` over `items` with at most `limit` calls in flight, resolving to the results in
 * input order. A rejection from any call rejects the whole map, exactly like Promise.all.
 *
 * The scheduled pollers used to await one Firestore query at a time — 60 project queries at
 * ~0.4s each is 24s of wall clock per run, and request-based Cloud Run billing charges the
 * instance for every one of those seconds whether or not the CPU is busy. Running the reads
 * a few at a time cuts the run to a fraction without changing the number of reads.
 */
async function mapWithConcurrency(items, limit, fn) {
    const list = Array.from(items)
    const results = new Array(list.length)
    const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, list.length))
    let nextIndex = 0

    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < list.length) {
            const index = nextIndex++
            results[index] = await fn(list[index], index)
        }
    })

    await Promise.all(workers)
    return results
}

module.exports = { mapWithConcurrency }
