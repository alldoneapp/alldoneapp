import { useEffect } from 'react'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import {
    unwatchIfNeedShowLaterEmptyGoalsButton,
    watchIfNeedShowLaterEmptyGoalsButton,
} from '../../../utils/backends/Tasks/tasksShowMoreButton'

export default function NeedShowMoreEmptyGoalsButton({ projectId }) {
    const userId = useSelector(state => state.currentUser.uid)

    useEffect(() => {
        const laterWatcherKey = v4()
        watchIfNeedShowLaterEmptyGoalsButton(projectId, userId, laterWatcherKey, true, false)

        const somedayWatcherKey = v4()
        watchIfNeedShowLaterEmptyGoalsButton(projectId, userId, somedayWatcherKey, false, true)

        return () => {
            unwatchIfNeedShowLaterEmptyGoalsButton(projectId, laterWatcherKey, true, false)
            unwatchIfNeedShowLaterEmptyGoalsButton(projectId, somedayWatcherKey, false, true)
        }
    }, [projectId, userId])

    return null
}
