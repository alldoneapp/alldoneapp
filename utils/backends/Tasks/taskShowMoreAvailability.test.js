import {
    classifyShowMoreDueDate,
    classifyShowMoreDueDates,
    combineShowMoreAvailability,
} from './taskShowMoreAvailability'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'

describe('task show-more availability', () => {
    const endOfDay = 1000
    const endOfTomorrow = 2000

    it('splits tomorrow, later future and someday in one pass', () => {
        expect(classifyShowMoreDueDate(1500, endOfDay, endOfTomorrow)).toEqual({
            later: true,
            tomorrow: true,
            future: false,
            someday: false,
        })
        expect(classifyShowMoreDueDate(3000, endOfDay, endOfTomorrow)).toEqual({
            later: true,
            tomorrow: false,
            future: true,
            someday: false,
        })
        expect(classifyShowMoreDueDate(BACKLOG_DATE_NUMERIC, endOfDay, endOfTomorrow)).toEqual({
            later: false,
            tomorrow: false,
            future: false,
            someday: true,
        })
    })

    it('ignores dates already visible today and malformed dates', () => {
        expect(classifyShowMoreDueDates([500, null, undefined], endOfDay, endOfTomorrow)).toEqual({
            later: false,
            tomorrow: false,
            future: false,
            someday: false,
        })
    })

    it('combines availability from assigned, observed, workstream and goal sources', () => {
        expect(
            combineShowMoreAvailability([{ later: true, tomorrow: true }, { future: true }, { someday: true }])
        ).toEqual({ later: true, tomorrow: true, future: true, someday: true })
    })
})
