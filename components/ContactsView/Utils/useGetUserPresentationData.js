import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { getAssistantPresentationData, getUnknownUserData, getUserPresentationData } from './ContactsHelper'
import { unwatch, watchUserData } from '../../../utils/backends/firestore'
import { getAssistantAuthorProjectIds, getAssistantFromState } from '../../AdminPanel/Assistants/assistantStateLookup'
import { findAssistantAuthor } from '../../../utils/backends/Assistants/assistantAuthorLookup'

export default function useGetUserPresentationData(userId, { fromAssistant = false } = {}) {
    const isAnonymous = useSelector(state => !!state.loggedUser.isAnonymous)
    const requestUserId = useSelector(state => state.loggedUser.uid)
    const assistant = useSelector(state => getAssistantFromState(state, userId))
    const projectIdsKey = useSelector(state => JSON.stringify(getAssistantAuthorProjectIds(state)))
    const scope = JSON.stringify([userId, requestUserId, isAnonymous, projectIdsKey])
    const [resolved, setResolved] = useState(null)
    const cached = assistant ? getAssistantPresentationData(assistant) : getUserPresentationData(userId)

    useEffect(() => {
        const userData = assistant ? getAssistantPresentationData(assistant) : getUserPresentationData(userId)
        if (!userId || !userData.isUnknownUser || isAnonymous) return

        let active = true
        let assistantResolved = false
        const update = data => {
            if (active) setResolved({ scope, data: data || getUnknownUserData() })
        }

        // Cross-project delegates may author comments before their home project is opened.
        // Also probe legacy comments without fromAssistant; an absent /users doc cannot tell
        // us that the author is missing. A late user miss must not erase a resolved assistant.
        findAssistantAuthor(userId, JSON.parse(projectIdsKey), requestUserId).then(profile => {
            if (!active || !profile) return
            assistantResolved = true
            update(getAssistantPresentationData(profile))
        })

        // An anonymous shared-resource view may render a message from a project member,
        // but it is not authorized to watch that member's private /users document.
        const watcherKey = !fromAssistant ? v4() : null
        if (watcherKey) {
            watchUserData(
                userId,
                false,
                data => {
                    if (!assistantResolved) update(data)
                },
                watcherKey
            )
        }
        return () => {
            active = false
            if (watcherKey) unwatch(watcherKey)
        }
    }, [userId, isAnonymous, requestUserId, assistant, projectIdsKey, fromAssistant, scope])

    return !cached.isUnknownUser ? cached : resolved?.scope === scope ? resolved.data : cached
}
