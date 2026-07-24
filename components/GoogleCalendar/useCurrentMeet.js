import { useEffect, useState } from 'react'
import Backend from '../../utils/BackendBridge'

export default function useCurrentMeet(projectId) {
    const [meetings, setMeetings] = useState(null)
    useEffect(() => {
        const unsubscribe = Backend.getDb().collection(`events/${projectId}/rooms`).onSnapshot(handleSnapshot)
        return () => {
            unsubscribe()
        }
    }, [])

    function handleSnapshot(snapshot) {
        const meet = snapshot.docs.map(doc => {
            return {
                id: doc.id,
                ...doc.data(),
            }
        })
        setMeetings(meet)
    }

    return meetings
}
