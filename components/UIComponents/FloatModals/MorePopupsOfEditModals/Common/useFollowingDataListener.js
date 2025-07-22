import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import Backend from '../../../../../utils/BackendBridge'

export default function useFollowingDataListener(projectId, followObjectsType, followObjectId) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [active, setActive] = useState(false)

    const updateFollowers = followersIds => {
        if (followersIds.includes(loggedUser.uid)) {
            setActive(true)
        } else {
            setActive(false)
        }
    }

    useEffect(() => {
        const watchId = Backend.getId()
        Backend.watchFollowers(projectId, followObjectsType, followObjectId, updateFollowers, watchId)
        return () => Backend.unsubsWatchFollowers(projectId, followObjectsType, followObjectId, watchId)
    }, [projectId])

    return [active, setActive]
}
