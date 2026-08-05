// Under react-native-web (migration Stage 2) component event handlers and
// effects really execute, so suites now reach utils/backends code that
// dereferences the firestore `db` - which is only assigned inside
// initFirebase() and stays undefined in tests. Suites fix that by
// jest.mock-ing the specific utils/backends/* functions their handlers call;
// this module supplies the shared building blocks so the stubs are not
// re-invented per suite.
//
// createDbStub() returns a permissive, chainable stand-in for a firestore
// database: doc()/collection() return objects whose query methods chain and
// whose get/set/update/delete return resolved promises, and onSnapshot
// immediately delivers an empty snapshot and returns an unsubscribe fn.

export const makeDocSnapshot = (data, id = 'stub-doc') => ({
    id,
    exists: data !== undefined,
    data: () => data,
    get: () => undefined,
    ref: { id },
})

export const makeQuerySnapshot = (docs = []) => ({
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: callback => docs.forEach(callback),
    docChanges: () => [],
})

export const createDbStub = () => {
    const docRef = {}
    const query = {}

    Object.assign(query, {
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        limitToLast: () => query,
        startAfter: () => query,
        startAt: () => query,
        endAt: () => query,
        endBefore: () => query,
        get: () => Promise.resolve(makeQuerySnapshot()),
        onSnapshot: (...args) => {
            const onNext = args.find(arg => typeof arg === 'function')
            if (onNext) onNext(makeQuerySnapshot())
            return () => {}
        },
        doc: () => docRef,
    })

    Object.assign(docRef, {
        id: 'stub-doc',
        get: () => Promise.resolve(makeDocSnapshot()),
        set: () => Promise.resolve(),
        update: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        onSnapshot: (...args) => {
            const onNext = args.find(arg => typeof arg === 'function')
            if (onNext) onNext(makeDocSnapshot())
            return () => {}
        },
        collection: () => query,
    })

    return {
        doc: () => docRef,
        collection: () => query,
        collectionGroup: () => query,
        batch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: () => Promise.resolve() }),
        runTransaction: updateFunction =>
            Promise.resolve(
                updateFunction({
                    get: () => Promise.resolve(makeDocSnapshot()),
                    set: () => {},
                    update: () => {},
                    delete: () => {},
                })
            ),
    }
}

// The most common override shape: a watcher that hands back an unsubscribe.
export const watchStub = () => jest.fn(() => jest.fn())
