import fs from 'fs'
import path from 'path'
import { parse } from '@babel/parser'
import { createStore } from 'redux'
import { reduceLoadingData } from '../../redux/loadingData'
import { beginLoadingOperation, runWithLoading, subscribeWithLoading } from '../redux/loadingOperation'
import { batchDispatch } from '../redux/dispatchBatch'

jest.mock('../redux/dispatchBatch', () => ({ batchDispatch: jest.fn() }))

// Execute the actual backend functions with a controllable Firestore transport.
// Loading ownership and Redux reduction stay real; no network or app-wide import graph is needed.
const source = fs.readFileSync(path.join(__dirname, 'firestore.js'), 'utf8')
const declarations = parse(source, { sourceType: 'module' }).program.body
const loadFunction = (name, dependencies) => {
    const declaration = declarations.find(node => node.declaration?.id?.name === name)?.declaration
    if (!declaration) throw new Error(`Missing backend function: ${name}`)
    return new Function(
        ...Object.keys(dependencies),
        `${source.slice(declaration.start, declaration.end)}; return ${name}`
    )(...Object.values(dependencies))
}

const bridgeSource = fs.readFileSync(path.join(__dirname, '../BackendBridge.js'), 'utf8')
const bridgeClass = parse(bridgeSource, { sourceType: 'module' }).program.body.find(
    node => node.type === 'ExportDefaultDeclaration'
).declaration
const loadBridge = backend =>
    new Function('bridge', `return ${bridgeSource.slice(bridgeClass.start, bridgeClass.end)}`)(backend)

const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

let store
beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    store = createStore((state = { isLoadingData: 0, loggedUser: { uid: 'user' } }, action) =>
        reduceLoadingData(state, action)
    )
    batchDispatch.mockImplementation(store.dispatch)
})
afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
})

const pendingSources = () =>
    Object.values(store.getState().loadingDataOperations || {}).map(operation => operation.source)

it.each([
    ['watchSubtasksList', 'subtasks'],
    ['watchGoalLinkedTasks', 'goal_linked_tasks'],
    ['watchHastagsColors', 'hashtag_color'],
])('%s releases its own wait on error and cancellation without clearing another load', (name, expectedSource) => {
    let fail
    const nativeUnsubscribe = jest.fn()
    const query = {
        collection: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        onSnapshot: (next, error) => {
            fail = error
            return nativeUnsubscribe
        },
    }
    const watchers = {}
    const watch = loadFunction(name, {
        db: query,
        store,
        subscribeWithLoading,
        getLoggedUserAccessReaderId: () => 'user',
        watchSubtaskList: watchers,
        globalWatcherUnsub: watchers,
        unsubHastagsColors: watchers,
    })
    const stopOther = beginLoadingOperation('unrelated')
    watch('project', 'item', name === 'watchHastagsColors' ? 'tag' : jest.fn(), 'watcher')
    expect(pendingSources()).toEqual(['unrelated', expectedSource])
    const stop = Object.values(watchers)[0]
    fail({ code: 'permission-denied' })
    expect(pendingSources()).toEqual(['unrelated'])
    stop()
    stop()
    expect(nativeUnsubscribe).toHaveBeenCalledTimes(1)
    expect(pendingSources()).toEqual(['unrelated'])
    stopOther()

    watch('project', 'item', name === 'watchHastagsColors' ? 'tag' : jest.fn(), 'watcher')
    Object.values(watchers)[0]()
    expect(store.getState().isLoadingData).toBe(0)
})

it('a late subtask snapshot cannot release a newer operation', () => {
    let next
    const watchers = {}
    const query = {
        collection: () => query,
        where: () => query,
        orderBy: () => query,
        onSnapshot: callback => {
            next = callback
            return jest.fn()
        },
    }
    const callback = jest.fn()
    const watch = loadFunction('watchSubtasksList', {
        db: query,
        store,
        subscribeWithLoading,
        watchSubtaskList: watchers,
        getLoggedUserAccessReaderId: () => 'user',
        mapTaskData: (id, data) => ({ id, ...data }),
    })
    watch('project', 'task', callback)
    watchers.task()
    const finish = beginLoadingOperation('newer')
    next({ docs: [] })
    expect(callback).not.toHaveBeenCalled()
    expect(pendingSources()).toEqual(['newer'])
    finish()
})

it.each(['setTaskDueDateMultiple', 'setTaskToBacklogMultiple'])(
    '%s waits for the batch acknowledgement and releases loading on rejection',
    async name => {
        const commit = deferred()
        const batch = { commit: jest.fn(() => commit.promise) }
        const update = loadFunction(name, {
            runWithLoading,
            db: {},
            BatchWrapper: function () {
                return batch
            },
            setTaskDueDate: jest.fn().mockResolvedValue(undefined),
            setTaskToBacklog: jest.fn().mockResolvedValue(undefined),
            startPerformanceTrace: () => ({ mark: jest.fn(), end: jest.fn() }),
        })
        const Backend = loadBridge({ [name]: update })
        const result = Backend[name]([{ id: 'task', projectId: 'project', sortIndex: 1 }], 123)
        await Promise.resolve()
        await Promise.resolve()
        expect(batch.commit).toHaveBeenCalledTimes(1)
        expect(store.getState().isLoadingData).toBe(1)
        const rejected = expect(result).rejects.toThrow('batch rejected')
        commit.reject(new Error('batch rejected'))
        await rejected
        expect(store.getState().isLoadingData).toBe(0)
    }
)

it('production callers cannot reintroduce the anonymous loading counter', () => {
    const root = path.resolve(__dirname, '../..')
    const offenders = []
    for (const directory of ['components', 'hooks', 'utils', 'URLSystem']) {
        for (const relative of fs.readdirSync(path.join(root, directory), { recursive: true })) {
            if (!relative.endsWith('.js') || relative.endsWith('.test.js')) continue
            const file = path.join(directory, relative)
            const text = fs.readFileSync(path.join(root, file), 'utf8')
            if (/\b(?:startLoadingData|stopLoadingData|resetLoadingData)\s*\(/.test(text)) offenders.push(file)
        }
    }
    expect(offenders).toEqual([])
})
