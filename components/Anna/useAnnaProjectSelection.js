import { useCallback, useEffect, useState } from 'react'
import { getAnnaHistoryWindow } from '../../functions/Assistant/annaHistoryWindow'
import { subscribePageVisible } from '../../utils/appResume'
import {
    ANNA_AUTOMATIC_PROJECT,
    isAnnaProjectSelectable,
    readAnnaProjectSelection,
    saveAnnaProjectSelection,
} from './annaProjectSelection'

// AT-2903 — the chat starts in the default project. Another project stays
// selected on this device until local midnight, when the next daily chat begins.
// AT-3024 — the start is shown as "Automatic" (`choiceId`), which continues the
// default project's chat. Picking the default project itself is an explicit choice
// and is remembered until midnight like any other project.
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
    const selected = current.projectId && isAnnaProjectSelectable(user, current.projectId) ? current.projectId : null

    const select = useCallback(
        projectId => {
            const dateKey = today()
            const chosen = projectId && projectId !== ANNA_AUTOMATIC_PROJECT ? projectId : null
            saveAnnaProjectSelection(userId, chosen, dateKey)
            setSelection(chosen ? { userId, projectId: chosen, dateKey } : { userId })
        },
        [userId, today]
    )

    return {
        projectId: selected || user.defaultProjectId || null,
        choiceId: selected || ANNA_AUTOMATIC_PROJECT,
        isAutomatic: !selected,
        isDefault: !selected || selected === user.defaultProjectId,
        select,
    }
}
