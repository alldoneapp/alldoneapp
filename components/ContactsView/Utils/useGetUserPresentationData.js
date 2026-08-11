import { useEffect, useState } from 'react'
import v4 from 'uuid/v4'

import { getUnknownUserData, getUserPresentationData } from './ContactsHelper'
import { unwatch, watchUserData } from '../../../utils/backends/firestore'

export default function useGetUserPresentationData(userId) {
    const [userData, setUserData] = useState(getUnknownUserData())

    const updateEditor = userData => {
        setUserData(userData || getUnknownUserData())
    }

    useEffect(() => {
        const userData = getUserPresentationData(userId)
        if (userId && userData.isUnknownUser) {
            const watcherKey = v4()
            watchUserData(userId, false, updateEditor, watcherKey)
            return () => {
                unwatch(watcherKey)
            }
        } else {
            setUserData(userData)
        }
    }, [userId])

    return userData
}
