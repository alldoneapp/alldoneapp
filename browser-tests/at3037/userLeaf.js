// Firestore-backed author lookup, replaced by the author of the reported screenshot.
export default function useGetUserPresentationData(userId) {
    return userId === 'cto'
        ? { displayName: 'Alldone CTO', photoURL: '', isAssistant: true }
        : { displayName: 'Karsten Wysk', photoURL: '' }
}
