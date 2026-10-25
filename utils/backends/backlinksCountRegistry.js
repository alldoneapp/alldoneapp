/**
 * Backlink counts for many objects of one project from ONE tasks query and ONE notes query.
 *
 * Every task row and goal header shows how many tasks and notes link to it, and used to open two
 * live listeners of its own for that (`backlinkIdsVisibleTo.<reader> array-contains <token>` on
 * tasks and on notes). The cost scaled with the length of the list, not with the number of
 * projects: 21 visible objects on the dogfooding account's All projects board were 42 listeners.
 *
 * The tokens are strings, so one `array-contains-any` query per project and collection answers up
 * to BACKLINK_TOKENS_PER_QUERY objects at once, and the counts are split per token on the client.
 * A new object joining is a query change, so additions are batched (REBUILD_DEBOUNCE_MS) and
 * removals are only applied when something is added anyway or the project goes idle: scrolling
 * rows out of view must not rebuild the query each time. The per-reader field keeps this a
 * single-clause query, which is the only shape the per-user map keys can use (no composite index
 * can exist per user).
 */
export const BACKLINK_TOKENS_PER_QUERY = 30
export const REBUILD_DEBOUNCE_MS = 150
export const IDLE_SHRINK_MS = 30 * 1000

const projects = new Map()
let nextConsumerId = 1

const chunk = (items, size) => {
    const chunks = []
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
    return chunks
}

const stableKey = (amount, alone) => `${amount}|${alone ? JSON.stringify(alone) : ''}`

const getProject = (projectId, context) => {
    const key = `${projectId}\u001f${context.readerKey}`
    let project = projects.get(key)
    if (!project) {
        project = {
            key,
            projectId,
            context,
            consumersByToken: new Map(),
            queriedTokens: [],
            groups: [],
            rebuildTimer: null,
            shrinkTimer: null,
        }
        projects.set(key, project)
    }
    return project
}

const tokensOf = project => [...project.consumersByToken.keys()].sort()

// Per collection: token -> { amount, alone } from the union of this project's group snapshots.
const computeCounts = (project, collection) => {
    const docsById = new Map()
    let ready = project.groups.length > 0
    project.groups.forEach(group => {
        const docs = group.docs[collection]
        if (!docs) {
            ready = false
            return
        }
        docs.forEach(doc => docsById.set(doc.id, doc))
    })
    if (!ready) return null

    const { readerField, acceptTask, acceptNote } = project.context
    const accept = collection === 'tasks' ? acceptTask : acceptNote
    const byToken = new Map()
    docsById.forEach(doc => {
        const data = doc.data()
        if (!accept(data)) return
        const docTokens = readerField.read(data)
        docTokens.forEach(token => {
            if (!project.consumersByToken.has(token)) return
            const entry = byToken.get(token) || { amount: 0, doc: null }
            entry.amount++
            entry.doc = doc
            byToken.set(token, entry)
        })
    })
    return byToken
}

const deliver = project => {
    ;['tasks', 'notes'].forEach(collection => {
        const counts = computeCounts(project, collection)
        if (!counts) return
        project.consumersByToken.forEach((consumers, token) => {
            // Only tokens the live query actually covers have an answer yet.
            if (!project.queriedTokens.includes(token)) return
            const entry = counts.get(token)
            const amount = entry?.amount || 0
            const alone = amount === 1 ? project.context.mapAlone(collection, entry.doc) : null
            const key = stableKey(amount, alone)
            consumers.forEach(consumer => {
                if (consumer.lastKey[collection] === key) return
                consumer.lastKey[collection] = key
                consumer.callback(collection, amount, alone)
            })
        })
    })
}

const closeGroups = project => {
    project.groups.forEach(group => group.unsubscribes.forEach(unsubscribe => unsubscribe()))
    project.groups = []
}

const rebuild = project => {
    clearTimeout(project.rebuildTimer)
    project.rebuildTimer = null
    const tokens = tokensOf(project)
    if (tokens.join('\u001f') === project.queriedTokens.join('\u001f') && project.groups.length > 0) return

    closeGroups(project)
    project.queriedTokens = tokens
    if (tokens.length === 0) {
        projects.delete(project.key)
        return
    }

    project.groups = chunk(tokens, BACKLINK_TOKENS_PER_QUERY).map(groupTokens => {
        const group = { docs: { tasks: null, notes: null }, unsubscribes: [] }
        ;['tasks', 'notes'].forEach(collection => {
            group.unsubscribes.push(
                project.context.subscribe(
                    collection,
                    groupTokens,
                    docs => {
                        group.docs[collection] = docs
                        deliver(project)
                    },
                    error => {
                        project.context.onError(collection, error)
                        group.docs[collection] = []
                        deliver(project)
                    }
                )
            )
        })
        return group
    })
}

const scheduleRebuild = project => {
    if (project.rebuildTimer) return
    project.rebuildTimer = setTimeout(() => rebuild(project), REBUILD_DEBOUNCE_MS)
}

const scheduleShrink = project => {
    clearTimeout(project.shrinkTimer)
    project.shrinkTimer = setTimeout(() => {
        project.shrinkTimer = null
        if (project.consumersByToken.size === 0 || tokensOf(project).length < project.queriedTokens.length)
            rebuild(project)
    }, IDLE_SHRINK_MS)
}

/**
 * `context` carries the Firestore specifics so this module stays testable:
 *   readerKey                  identifies the reader (one query set per reader and project)
 *   readerField.read(data)     the doc's token list for this reader
 *   acceptTask / acceptNote    visibility filters, as the old per-object listeners applied
 *   mapAlone(collection, doc)  the object handed out when exactly one links here
 *   subscribe(collection, tokens, onDocs, onError) → unsubscribe
 *   onError(collection, error)
 */
export function subscribeBacklinksCount(projectId, token, callback, context) {
    const project = getProject(projectId, context)
    const consumer = { id: nextConsumerId++, callback, lastKey: {} }
    const consumers = project.consumersByToken.get(token) || new Set()
    const isNewToken = consumers.size === 0
    consumers.add(consumer)
    project.consumersByToken.set(token, consumers)

    if (isNewToken && !project.queriedTokens.includes(token)) scheduleRebuild(project)
    else deliver(project)

    return () => {
        const current = project.consumersByToken.get(token)
        if (!current) return
        current.delete(consumer)
        if (current.size === 0) project.consumersByToken.delete(token)
        if (project.consumersByToken.size === 0 && !project.rebuildTimer) {
            // Nothing on screen needs this project any more: close it straight away.
            closeGroups(project)
            clearTimeout(project.shrinkTimer)
            projects.delete(project.key)
            return
        }
        scheduleShrink(project)
    }
}

export const resetBacklinksCountRegistryForTests = () => {
    projects.forEach(project => {
        clearTimeout(project.rebuildTimer)
        clearTimeout(project.shrinkTimer)
        closeGroups(project)
    })
    projects.clear()
}
