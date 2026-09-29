import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { getUnknownUserData, getUserPresentationData } from './ContactsHelper'
import { unwatch, watchUserData } from '../../../utils/backends/firestore'

export default function useGetUserPresentationData(userId) {
    const isAnonymous = useSelector(state => !!state.loggedUser.isAnonymous)
    const [userData, setUserData] = useState(getUnknownUserData())

    const updateEditor = userData => {
        setUserData(userData || getUnknownUserData())
    }

    useEffect(() => {
        const userData = getUserPresentationData(userId)
        // An anonymous shared-resource view may render a message from a project member,
        // but it is not authorized to watch that member's private /users document.
        if (userId && userData.isUnknownUser && !isAnonymous) {
            const watcherKey = v4()
            watchUserData(userId, false, updateEditor, watcherKey)
            return () => {
                unwatch(watcherKey)
            }
        } else {
            setUserData(userData)
        }
    }, [userId, isAnonymous])

    return userData
}
