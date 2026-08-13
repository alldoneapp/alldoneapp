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

const buildDocumentUrl = documentPath => {
    const { apiKey, projectId } = firebase.app().options
    const normalizedPath = String(documentPath || '')
        .replace(/^\/+/, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/')
    const baseUrl = shouldUseEmulator()
        ? `http://127.0.0.1:8080/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`
        : `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`
    return `${baseUrl}/${normalizedPath}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`
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
    const response = await fetch(buildDocumentUrl(documentPath), {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${idToken}` },
    })

    if (response.status === 404) return { exists: false, data: undefined }
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

    const document = await response.json()
    return {
        exists: true,
        data: decodeFields(document.fields || {}),
    }
}
