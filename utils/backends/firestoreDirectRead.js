import firebase from 'firebase/compat/app'

// The regular Firestore client serves the whole app: local state, listeners and writes. This
// small, lazily loaded Firestore Lite client is deliberately used only to verify an apparent
// missing document. Lite has no local cache or snapshot-listener state, so its getDoc() is an
// independent, direct server read instead of a second answer from the same possibly wedged
// Listen stream.
let liteContextPromise

const shouldUseEmulator = () =>
    typeof window !== 'undefined' && window.location && window.location.search.includes('emulator=true')

const getLiteContext = async () => {
    if (!liteContextPromise) {
        liteContextPromise = import('firebase/firestore/lite')
            .then(lite => {
                const firestore = lite.getFirestore(firebase.app())
                if (shouldUseEmulator()) lite.connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
                return { firestore, lite }
            })
            .catch(error => {
                // A transient chunk/network failure must not poison every later verification in
                // this session. Let the next missing-document check try loading Lite again.
                liteContextPromise = null
                throw error
            })
    }
    return liteContextPromise
}

export const readDocumentDirectlyFromServer = async documentPath => {
    const { firestore, lite } = await getLiteContext()
    const normalizedPath = String(documentPath || '').replace(/^\/+/, '')
    const snapshot = await lite.getDoc(lite.doc(firestore, normalizedPath))
    return {
        exists: snapshot.exists(),
        data: snapshot.data(),
    }
}
