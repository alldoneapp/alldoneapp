import { buildCalendarGoalRoutingFeedback, buildCalendarProjectRoutingFeedback } from './CalendarRoutingFeedback'

describe('buildCalendarProjectRoutingFeedback', () => {
    test('captures the connected calendar project and the authoritative manual destination', () => {
        expect(
            buildCalendarProjectRoutingFeedback({
                task: {
                    id: 'event-1',
                    projectId: 'wrong-project',
                    calendarData: {
                        originalProjectId: 'calendar-project',
                        projectRouting: {
                            syncProjectId: 'calendar-project',
                            chosenProjectId: 'wrong-project',
                        },
                    },
                },
                sourceProjectId: 'wrong-project',
                targetProjectId: 'correct-project',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-1',
                requestedAt: 123,
            })
        ).toEqual({
            version: 1,
            feedbackId: 'feedback-1',
            requestedAt: 123,
            requestedByUserId: 'user-1',
            syncProjectId: 'calendar-project',
            movedFromProjectId: 'wrong-project',
            movedToProjectId: 'correct-project',
            previousRoutedProjectId: 'wrong-project',
        })
    })

    test('falls back to the source project for legacy calendar tasks', () => {
        expect(
            buildCalendarProjectRoutingFeedback({
                task: { calendarData: { email: 'me@example.com' } },
                sourceProjectId: 'calendar-project',
                targetProjectId: 'correct-project',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-1',
            })
        ).toEqual(expect.objectContaining({ syncProjectId: 'calendar-project' }))
    })

    test('does not create feedback for non-calendar or no-op moves', () => {
        expect(
            buildCalendarProjectRoutingFeedback({
                task: { id: 'task-1' },
                sourceProjectId: 'a',
                targetProjectId: 'b',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-1',
            })
        ).toBeNull()
        expect(
            buildCalendarProjectRoutingFeedback({
                task: { calendarData: {} },
                sourceProjectId: 'a',
                targetProjectId: 'a',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-1',
            })
        ).toBeNull()
    })
})

describe('buildCalendarGoalRoutingFeedback', () => {
    const calendarTask = {
        projectId: 'project-a',
        parentGoalId: 'goal-old',
        calendarData: {
            originalProjectId: 'calendar-project',
            recurringEventId: 'series-1',
        },
    }

    test('captures a manual Goal assignment', () => {
        expect(
            buildCalendarGoalRoutingFeedback({
                task: calendarTask,
                projectId: 'project-a',
                selectedGoalId: 'goal-new',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-2',
                requestedAt: 456,
            })
        ).toEqual({
            version: 1,
            feedbackId: 'feedback-2',
            requestedAt: 456,
            requestedByUserId: 'user-1',
            syncProjectId: 'calendar-project',
            projectId: 'project-a',
            previousGoalId: 'goal-old',
            selectedGoalId: 'goal-new',
        })
    })

    test('captures an explicit Goal removal', () => {
        expect(
            buildCalendarGoalRoutingFeedback({
                task: calendarTask,
                projectId: 'project-a',
                selectedGoalId: null,
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-3',
            })
        ).toEqual(
            expect.objectContaining({
                previousGoalId: 'goal-old',
                selectedGoalId: null,
            })
        )
    })

    test('ignores non-calendar tasks and no-op Goal selections', () => {
        expect(
            buildCalendarGoalRoutingFeedback({
                task: { parentGoalId: 'goal-old' },
                projectId: 'project-a',
                selectedGoalId: 'goal-new',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-4',
            })
        ).toBeNull()
        expect(
            buildCalendarGoalRoutingFeedback({
                task: calendarTask,
                projectId: 'project-a',
                selectedGoalId: 'goal-old',
                requestedByUserId: 'user-1',
                feedbackId: 'feedback-5',
            })
        ).toBeNull()
    })
})
