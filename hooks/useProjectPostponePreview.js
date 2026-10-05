import { useCallback, useSyncExternalStore } from 'react'
import { useSelector } from 'react-redux'

import { getProjectPostpone, subscribeProjectPostpone } from '../utils/backends/Tasks/optimisticProjectPostpone'

export default function useProjectPostponePreview(projectId) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const getSnapshot = useCallback(() => getProjectPostpone(projectId, userId), [projectId, userId])
    return useSyncExternalStore(subscribeProjectPostpone, getSnapshot, getSnapshot)
}
