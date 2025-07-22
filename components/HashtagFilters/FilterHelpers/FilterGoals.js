import store from '../../../redux/store'
import { matchSearch } from '../HashtagFiltersHelper'

/**
 * Determine if a task match with the term list
 *
 * @param goal
 * @returns {boolean}
 */
export const goalMatchHashtagFilters = goal => {
    const termList = Array.from(store.getState().hashtagFilters.keys())

    return termList.length === 0 || matchSearch(goal.name, termList)
}

export const filterGoals = goals => {
    return goals.filter(goal => goalMatchHashtagFilters(goal))
}
