import { useEffect, useState } from 'react'

import Backend from '../utils/BackendBridge'

export default function useObjectNote(projectId, noteId) {
    const [note, setNote] = useState(null)

    useEffect(() => {
        if (noteId) {
            Backend.watchNote(projectId, noteId, setNote)
            return () => {
                Backend.unwatchNote(projectId, noteId)
            }
        }
    }, [noteId])

    return note
}
