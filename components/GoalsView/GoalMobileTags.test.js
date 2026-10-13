import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ currentUser: { uid: 'u1' }, loggedUserProjectsMap: {} }),
}))
jest.mock('./GoalItemTagsArea', () => 'GoalItemTagsArea')
jest.mock('../Tags/TaskSummarizeTags', () => 'TaskSummarizeTags')
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: () => ({ goalMilestonesConfig: { mode: 'linear' } }),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    getHandlerData: id => ({ handler: id === 'missing' ? null : {}, isPublicForLoggedUser: id !== 'private' }),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))

import GoalMobileTags, { getMobileGoalTagsAmount } from './GoalMobileTags'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'

const baseProps = () => ({
    projectId: 'p1',
    goal: {
        id: 'g1',
        description: '',
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        assigneesIds: ['u1'],
        assigneesReminderDate: { u1: moment().startOf('day').valueOf() },
        completionMilestoneDate: moment().add(3, 'days').valueOf(),
        timesPostponed: 196,
    },
    tasksAmount: 130,
    parentMilestonesData: { milestonesAmount: 1 },
    inParentGoal: true,
    disableTagsActions: true,
    loggedUserCanUpdateObject: false,
})
const project = { goalMilestonesConfig: { mode: 'linear' } }

describe('mobile goal tag group', () => {
    it('counts coffee, schedule, tasks and avatar without the milestone date', () => {
        const props = baseProps()
        expect(getMobileGoalTagsAmount(props, 'u1', {}, project)).toBe(4)
        props.goal.completionMilestoneDate = Number.MAX_SAFE_INTEGER
        expect(getMobileGoalTagsAmount(props, 'u1', {}, project)).toBe(4)
    })

    it('omits hidden/missing avatars and schedule tags outside linear milestones', () => {
        const props = baseProps()
        props.goal.assigneesIds = ['u1', 'private', 'missing']
        expect(getMobileGoalTagsAmount(props, 'u1', {}, { goalMilestonesConfig: { mode: 'manual' } })).toBe(3)
    })

    it('counts focus area and tomorrow reminder, but excludes backlog reminder and popup comments', () => {
        const props = baseProps()
        props.goal.focusAreaId = 'focus'
        props.goal.assigneesReminderDate.u1 = moment().add(1, 'day').valueOf()
        props.commentsData = { amount: 1 }
        expect(getMobileGoalTagsAmount(props, 'u1', { focus: { name: 'Work' } }, project)).toBe(7)
        props.goal.assigneesReminderDate.u1 = Number.MAX_SAFE_INTEGER
        props.inCommentPopup = true
        expect(getMobileGoalTagsAmount(props, 'u1', { focus: { name: 'Work' } }, project)).toBe(5)
    })

    it('handles standalone goals and collapses done assignees into one badge', () => {
        const props = baseProps()
        delete props.inParentGoal
        props.goal.assigneesIds = ['u1', 'u2', 'u3']
        props.inDoneMilestone = true
        expect(getMobileGoalTagsAmount(props, 'u1', {}, project)).toBe(4)
    })

    it('initially renders just date and summary, expanding and collapsing without editing', () => {
        const props = baseProps()
        let tree
        act(() => {
            tree = renderer.create(<GoalMobileTags {...props} />)
        })
        expect(tree.root.findAllByType('GoalItemTagsArea')).toHaveLength(1)
        expect(tree.root.findByType('GoalItemTagsArea').props.milestoneOnly).toBe(true)
        const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
        act(() => tree.root.findByType('TaskSummarizeTags').props.onPress(event))
        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        const expanded = tree.root.findAllByType('GoalItemTagsArea')[1]
        expect(expanded.props).toMatchObject({
            hideMilestone: true,
            showAssignees: true,
            disableTagsActions: true,
            loggedUserCanUpdateObject: false,
        })
        act(() => tree.root.findByType('TaskSummarizeTags').props.onPress(event))
        expect(tree.root.findAllByType('GoalItemTagsArea')).toHaveLength(1)
        expect(tree.root.findByType('TaskSummarizeTags').props.expanded).toBe(false)
        act(() => tree.unmount())
    })
})
