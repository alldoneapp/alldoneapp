import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { isWorkstream } from '../../Workstreams/WorkstreamHelper'
import {
    unwatchOpenTasksAmount,
    watchObservedOpenTasksAmount,
    watchOpenTasksAmount,
    watchUserWorkstreamsOpenTasksAmount,
} from '../../../utils/backends/Tasks/taskNumbers'
import { setOpenTasksAmountLoaded, setTaskColdStartEmptyToday } from '../../../redux/actions'
import { scheduleTaskColdStartCachePersist } from '../../../utils/InitialLoad/taskColdStartCache'
import store from '../../../redux/store'

/**
 * AT-2445: a Firestore listener that is simply slow must not keep a genuinely empty inbox from ever
 * being reported as empty. Every listener also reports on its error branch, so this only fires for a
 * listener that neither succeeds nor fails — but "the congrats never appears again" is a far worse
 * outcome than "it appears a few seconds later", so the readiness signal fails OPEN.
 */
export const OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS = 8000

export default function OpenTasksAmountContainer({ projectIds }) {
    const dispatch = useDispatch()
    const countLaterTasks = useSelector(state => state.laterTasksExpanded)
    const countSomedayTasks = useSelector(state => state.somedayTasksExpanded)

    const isAssistant = useSelector(state => !!state.currentUser.temperature)
    const isContact = useSelector(state => !!state.currentUser.recorderUserId)
    const userId = useSelector(state => state.currentUser.uid)
    const userWorkstreams = useSelector(state => state.currentUser.workstreams)

    const amountsByProject = useRef({ total: 0 })

    const userWorkstreamsString = userWorkstreams
        ? JSON.stringify(Object.keys(userWorkstreams).sort()) + JSON.stringify(Object.values(userWorkstreams).sort())
        : ''
    const projectIdsString = JSON.stringify(projectIds)

    useEffect(() => {
        const isUser = !isAssistant && !isContact && !isWorkstream(userId)

        // Readiness is scoped to THIS set of watchers. A late snapshot from the previous generation
        // (the effect re-runs whenever the project list, the Later/Someday toggles or the
        // workstreams change) must not be able to mark the new generation ready.
        const settledQueries = new Set()
        let expectedQueryTokens = []
        let announced = false

        const markReady = () => {
            if (announced) return
            announced = true
            dispatch(setOpenTasksAmountLoaded(true))
            // The live aggregate has taken over. Do not reuse the cold-start proof when these
            // watchers are rebuilt later by a Today/Later/Someday toggle.
            dispatch(setTaskColdStartEmptyToday(null))
            scheduleTaskColdStartCachePersist(store.getState)
        }

        const onQuerySettled = token => {
            settledQueries.add(token)
            if (expectedQueryTokens.length > 0 && settledQueries.size >= expectedQueryTokens.length) markReady()
        }

        const normalWatcherKeys = projectIds.map(() => v4())
        const normalTokens = watchOpenTasksAmount(
            projectIds,
            userId,
            countLaterTasks,
            countSomedayTasks,
            amountsByProject.current,
            normalWatcherKeys,
            onQuerySettled
        )

        let observedWatcherKeys = []
        let userWorkstreamsWatcherKeys = []
        let observedTokens = []
        let workstreamTokens = []

        if (isUser) {
            observedWatcherKeys = projectIds.map(() => v4())
            observedTokens = watchObservedOpenTasksAmount(
                projectIds,
                userId,
                countLaterTasks,
                countSomedayTasks,
                amountsByProject.current,
                observedWatcherKeys,
                onQuerySettled
            )
            userWorkstreamsWatcherKeys = projectIds.map(() => v4())
            workstreamTokens = watchUserWorkstreamsOpenTasksAmount(
                projectIds,
                userWorkstreams,
                countLaterTasks,
                countSomedayTasks,
                amountsByProject.current,
                userWorkstreamsWatcherKeys,
                onQuerySettled
            )
        }

        expectedQueryTokens = [...normalTokens, ...observedTokens, ...workstreamTokens]

        // Registration is synchronous, but a cached Firestore snapshot can be delivered before this
        // line runs, so re-check rather than relying on the callback alone.
        //
        // An EMPTY project list deliberately does not mark ready. `TasksAmountContainers` mounts
        // with `useState([])` for one pass before the real project list arrives — treating that as
        // "counted, and the answer is zero" would reopen exactly the hole this closes. A user who
        // genuinely has no projects is covered by the fail-open timeout below.
        if (expectedQueryTokens.length > 0 && settledQueries.size >= expectedQueryTokens.length) markReady()

        const readyTimeout = setTimeout(markReady, OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS)

        return () => {
            clearTimeout(readyTimeout)
            announced = true
            unwatchOpenTasksAmount([...normalWatcherKeys, ...observedWatcherKeys, ...userWorkstreamsWatcherKeys])
            amountsByProject.current = { total: 0 }
        }
    }, [projectIdsString, userId, countLaterTasks, countSomedayTasks, userWorkstreamsString])

    return null
}
