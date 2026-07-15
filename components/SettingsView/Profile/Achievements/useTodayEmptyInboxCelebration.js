import { useEffect, useRef, useState } from 'react'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from './AchievementsHelper'

export default function useTodayEmptyInboxCelebration(emptyInboxDays, enabled) {
    const todayKey = moment().format(EMPTY_INBOX_DATE_FORMAT)
    const achievedToday = emptyInboxDays.includes(todayKey)
    const previouslyAchievedToday = useRef(achievedToday)
    const [celebrationRunId, setCelebrationRunId] = useState(0)

    useEffect(() => {
        if (enabled && !previouslyAchievedToday.current && achievedToday) {
            setCelebrationRunId(runId => runId + 1)
        }

        previouslyAchievedToday.current = achievedToday
    }, [achievedToday, enabled])

    return celebrationRunId
}
