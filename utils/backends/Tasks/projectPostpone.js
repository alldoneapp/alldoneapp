import moment from 'moment'
import v4 from 'uuid/v4'

import { runHttpsCallableFunction } from '../firestore'
import { runWithLoading } from '../../redux/loadingOperation'

export const postponeProjectTasks = (projectId, date, mode = 'date') =>
    runWithLoading('postpone_project', () =>
        runHttpsCallableFunction('postponeProjectTasksWithUndoSecondGen', {
            projectId,
            mode,
            ...(mode === 'date' ? { date } : {}),
            timezoneOffset: moment().utcOffset(),
            requestId: v4(),
        })
    )
