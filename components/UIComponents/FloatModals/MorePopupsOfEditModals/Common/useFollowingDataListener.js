import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import Backend from '../../../../../utils/BackendBridge'
import SharedHelper from '../../../../../utils/SharedHelper'

export default function useFollowingDataListener(projectId, followObjectsType, followObjectId) {
    const loggedUser = useSelector(state => state.loggedUser)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const [active, setActive] = useState(false)
    const canWatchFollowers = !!project && SharedHelper.accessGranted(loggedUser, projectId)

    const updateFollowers = followersIds => {
        if (followersIds.includes(loggedUser.uid)) {
            setActive(true)
        } else {
            setActive(false)
        }
    }

    useEffect(() => {
        if (!canWatchFollowers || !followObjectId) {
            setActive(false)
            return undefined
        }

        const watchId = Backend.getId()
        Backend.watchFollowers(projectId, followObjectsType, followObjectId, updateFollowers, watchId)
        return () => Backend.unsubsWatchFollowers(projectId, followObjectsType, followObjectId, watchId)
    }, [canWatchFollowers, followObjectId, followObjectsType, loggedUser.uid, projectId])

    return [active, setActive]
}
