import React, { useEffect, useState } from 'react'
import Backend from '../utils/BackendBridge'

export default function useBacklinks(projectId, type, idsField, objectId) {
    const [backlinksTasksCount, setBacklinksTasksCount] = useState(0)
    const [backlinkTaskObject, setBacklinkTaskObject] = useState(null)
    const [backlinksNotesCount, setBacklinksNotesCount] = useState(0)
    const [backlinkNoteObject, setBacklinkNoteObject] = useState(null)

    useEffect(() => {
        if (projectId && type && idsField && objectId) {
            Backend.watchBacklinksCount(
                projectId,
                {
                    type: type,
                    idsField: idsField,
                    id: objectId,
                },
                (parentObjectType, parentsAmount, aloneParentObject) => {
                    if (parentObjectType === 'tasks') {
                        setBacklinksTasksCount(parentsAmount)
                        setBacklinkTaskObject(aloneParentObject)
                    } else if (parentObjectType === 'notes') {
                        setBacklinksNotesCount(parentsAmount)
                        setBacklinkNoteObject(aloneParentObject)
                    }
                }
            )
            return () => Backend.unwatchBacklinksCount(objectId)
        }
    }, [projectId, type, idsField, objectId])

    return { backlinksTasksCount, backlinkTaskObject, backlinksNotesCount, backlinkNoteObject }
}
