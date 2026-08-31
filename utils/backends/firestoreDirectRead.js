import firebase from 'firebase/compat/app'

const shouldUseEmulator = () =>
    typeof window !== 'undefined' && window.location && window.location.search.includes('emulator=true')

const decodeBytes = base64 => {
    if (firebase.firestore?.Blob?.fromBase64String) {
        return firebase.firestore.Blob.fromBase64String(base64)
    }
    return base64
}

const decodeReference = reference => {
    const documentsMarker = '/documents/'
    const markerIndex = reference.indexOf(documentsMarker)
    if (markerIndex < 0) return reference
    try {
        return firebase.firestore().doc(reference.slice(markerIndex + documentsMarker.length))
    } catch (error) {
        return reference
    }
}

const decodeValue = value => {
    if (!value || typeof value !== 'object') return null
    if ('nullValue' in value) return null
    if ('booleanValue' in value) return value.booleanValue
    if ('integerValue' in value) return Number(value.integerValue)
    if ('doubleValue' in value) return Number(value.doubleValue)
    if ('timestampValue' in value) {
        const date = new Date(value.timestampValue)
        return firebase.firestore?.Timestamp?.fromDate ? firebase.firestore.Timestamp.fromDate(date) : date
    }
    if ('stringValue' in value) return value.stringValue
    if ('bytesValue' in value) return decodeBytes(value.bytesValue)
    if ('referenceValue' in value) return decodeReference(value.referenceValue)
    if ('geoPointValue' in value) {
        const { latitude, longitude } = value.geoPointValue
        return firebase.firestore?.GeoPoint
            ? new firebase.firestore.GeoPoint(latitude, longitude)
            : { latitude, longitude }
    }
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
    if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
    return null
}

const decodeFields = fields =>
    Object.keys(fields).reduce((data, field) => {
        data[field] = decodeValue(fields[field])
        return data
    }, {})

const getDirectReadTarget = documentPath => {
    const { apiKey, projectId } = firebase.app().options
    const normalizedPath = String(documentPath || '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
    const databaseName = `projects/${projectId}/databases/(default)`
    const baseUrl = shouldUseEmulator()
        ? `http://127.0.0.1:8080/v1/${databaseName}`
        : `https://firestore.googleapis.com/v1/${databaseName}`
    return {
        documentName: `${databaseName}/documents/${normalizedPath}`,
        url: `${baseUrl}/documents:batchGet${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`,
    }
}

// The regular Firestore client serves the whole app: local state, listeners and writes. An
// apparent absence must not be verified by that same client's possibly wedged Listen stream.
// Firestore Lite cannot coexist with the compat-registered service in this webpack build
// (`Service firestore/lite is not available` in production), so use Firestore's authenticated
// REST document endpoint instead. It has no local cache/listener state and applies the same
// Firebase Auth security rules through the user's ID token.
export const readDocumentDirectlyFromServer = async documentPath => {
    const currentUser = firebase.auth().currentUser
    if (!currentUser) throw new Error('Cannot verify a Firestore document without an authenticated user')

    const idToken = await currentUser.getIdToken()
    const target = getDirectReadTarget(documentPath)
    const response = await fetch(target.url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documents: [target.documentName] }),
    })

    if (!response.ok) {
        let details
        try {
            details = await response.json()
        } catch (error) {
            details = null
        }
        const directReadError = new Error(
            details?.error?.message || `Direct Firestore read failed with HTTP ${response.status}`
        )
        directReadError.code = details?.error?.status || `http-${response.status}`
        throw directReadError
    }

    // batchGet deliberately represents a missing document in a successful HTTP 200 response.
    // This keeps first-time signup out of Chrome's red 404 network/error path while retaining
    // the independent server verification that protects an existing account from being reset.
    const payload = await response.json()
    const results = Array.isArray(payload) ? payload : [payload]
    const result = results.find(item => item?.found || item?.missing)
    if (result?.missing) return { exists: false, data: undefined }
    if (!result?.found) throw new Error('Direct Firestore batch read returned no document result')

    return {
        exists: true,
        data: decodeFields(result.found.fields || {}),
    }
}
