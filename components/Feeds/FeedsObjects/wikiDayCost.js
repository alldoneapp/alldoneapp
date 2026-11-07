import { useEffect, useState } from 'react'
import moment from 'moment'

import { getKnowledgeRunsStartedBefore } from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'

// What the wiki cost on the day of its Updates card, read from the runs themselves
// (knowledgeBases/{projectId}/runs, which every member may read). Per run, not per line: one run
// rewrites many pages, so a cost on each line would add up to many times what was spent. A run
// writes `goldSpent` when it finishes; one still going counts as running and adds nothing yet.
// Member corrections are not wiki runs: their model calls are billed to the chat they came from.

const CACHE_MS = 60 * 1000
const cache = new Map()

export function getWikiDayBounds(day) {
    const start = moment(day, 'YYYYMMDD', true)
    if (!start.isValid()) return null
    return { start: start.valueOf(), end: start.clone().add(1, 'day').valueOf() }
}

// The runs that worked during [start, end): started before the end, and finished (or, while still
// running, started) after the start.
export function summarizeWikiDayCost(runs, { start, end }) {
    let gold = 0
    let runCount = 0
    let running = false
    for (const run of runs || []) {
        const startedAt = Number(run?.startedAt)
        if (!Number.isFinite(startedAt) || startedAt >= end) continue
        const finishedAt = Number(run.finishedAt)
        const finished = Number.isFinite(finishedAt)
        if ((finished ? finishedAt : startedAt) < start) continue
        runCount += 1
        if (finished) gold += Math.max(0, Number(run.goldSpent) || 0)
        else running = true
    }
    return { gold: Math.round(gold), runCount, running }
}

export function loadWikiDayCost(projectId, day, now = Date.now()) {
    const bounds = getWikiDayBounds(day)
    if (!projectId || !bounds) return Promise.resolve(null)
    const key = `${projectId}/${day}`
    const cached = cache.get(key)
    if (cached && now - cached.at < CACHE_MS) return cached.promise
    const promise = getKnowledgeRunsStartedBefore(projectId, bounds.end)
        .then(runs => summarizeWikiDayCost(runs, bounds))
        .catch(() => null)
    cache.set(key, { promise, at: now })
    return promise
}

export function clearWikiDayCosts() {
    cache.clear()
}

// null until the runs are read, and when they cannot be.
export default function useWikiDayCost(projectId, day) {
    const [cost, setCost] = useState(null)

    useEffect(() => {
        let cancelled = false
        setCost(null)
        loadWikiDayCost(projectId, day).then(loaded => !cancelled && setCost(loaded))
        return () => {
            cancelled = true
        }
    }, [projectId, day])

    return cost
}
