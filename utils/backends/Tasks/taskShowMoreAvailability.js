import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'

export const EMPTY_SHOW_MORE_AVAILABILITY = Object.freeze({
    later: false,
    tomorrow: false,
    future: false,
    someday: false,
})

/**
 * Classify the hidden part of a task/goal date without requiring separate
 * Firestore queries for later, future and someday. `later` deliberately covers
 * every finite date after today; `tomorrow` and `future` split that range for
 * the two-step All Projects expander.
 */
export const classifyShowMoreDueDate = (dueDate, endOfDay, endOfTomorrow) => {
    const someday = dueDate === BACKLOG_DATE_NUMERIC
    const later = Number.isFinite(dueDate) && dueDate > endOfDay && dueDate < BACKLOG_DATE_NUMERIC

    return {
        later,
        tomorrow: later && dueDate <= endOfTomorrow,
        future: later && dueDate > endOfTomorrow,
        someday,
    }
}

export const combineShowMoreAvailability = values => {
    return (values || []).reduce(
        (combined, value) => ({
            later: combined.later || !!value?.later,
            tomorrow: combined.tomorrow || !!value?.tomorrow,
            future: combined.future || !!value?.future,
            someday: combined.someday || !!value?.someday,
        }),
        { ...EMPTY_SHOW_MORE_AVAILABILITY }
    )
}

export const classifyShowMoreDueDates = (dueDates, endOfDay, endOfTomorrow) => {
    return combineShowMoreAvailability(
        (dueDates || []).map(dueDate => classifyShowMoreDueDate(dueDate, endOfDay, endOfTomorrow))
    )
}
