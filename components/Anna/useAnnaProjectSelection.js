import { useCallback, useEffect, useState } from 'react'
import { getAnnaHistoryWindow } from '../../functions/Assistant/annaHistoryWindow'
import { subscribePageVisible } from '../../utils/appResume'
import { isAnnaProjectSelectable, readAnnaProjectSelection, saveAnnaProjectSelection } from './annaProjectSelection'

// AT-2903 — the chat starts in the default project. Another project stays
// selected on this device until local midnight, when the next daily chat begins.
export default function useAnnaProjectSelection(user = {}) {
    const userId = user.uid
    const today = useCallback(
        () => getAnnaHistoryWindow(user).today,
        [user.timezone, user.preferredTimezone, user.timezoneOffset, user.timezoneMinutes]
    )
    const [selection, setSelection] = useState(() => ({ userId, ...readAnnaProjectSelection(userId, today()) }))

    useEffect(() => {
        setSelection({ userId, ...readAnnaProjectSelection(userId, today()) })
        const expire = () =>
            setSelection(previous =>
                previous.projectId && previous.dateKey !== today() ? { userId: previous.userId } : previous
            )
        const timer = setInterval(expire, 30000)
        const stop = subscribePageVisible(expire)
        return () => {
            clearInterval(timer)
            stop()
        }
    }, [userId, today])

    const current = selection.userId === userId ? selection : {}
    const selected =
        current.projectId &&
        current.projectId !== user.defaultProjectId &&
        isAnnaProjectSelectable(user, current.projectId)
            ? current.projectId
            : null

    const select = useCallback(
        projectId => {
            const dateKey = today()
            const other = projectId && projectId !== user.defaultProjectId ? projectId : null
            saveAnnaProjectSelection(userId, other, dateKey)
            setSelection(other ? { userId, projectId: other, dateKey } : { userId })
        },
        [userId, user.defaultProjectId, today]
    )

    return { projectId: selected || user.defaultProjectId || null, isDefault: !selected, select }
}
