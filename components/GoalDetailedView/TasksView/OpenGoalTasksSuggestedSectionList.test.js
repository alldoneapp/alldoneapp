import React from 'react'
import renderer, { act } from 'react-test-renderer'

import OpenGoalTasksSuggestedSectionList from './OpenGoalTasksSuggestedSectionList'

jest.mock('./GoalTasksList', () => 'GoalTasksList')
jest.mock('../../Suggeted/SuggestedBulkActions', () => 'SuggestedBulkActions')
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: () => ({ photoURL: 'generic-user.svg' }),
}))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: key => key,
}))
jest.mock('../../../utils/backends/Tasks/openGoalTasks', () => ({
    SUGGESTED_TASK_INDEX: 2,
}))

const suggestedTask = id => ({
    id,
    suggestedBy: 'assistant-1',
    taskMetadata: { assistantSuggestion: { assistantId: 'assistant-1' } },
})

const renderList = suggestedTasks => {
    let tree
    act(() => {
        tree = renderer.create(
            <OpenGoalTasksSuggestedSectionList
                suggestedTasks={suggestedTasks}
                projectId="project-1"
                dateIndex={0}
                isActiveOrganizeMode={false}
            />
        )
    })
    return tree
}

describe('OpenGoalTasksSuggestedSectionList bulk actions', () => {
    // The goal detailed view is the second place the "Suggested" section renders, so the
    // single-suggestion visibility rule has to hold here too (AT-2173 follow-up).
    test('mounts the bulk actions for a single suggestion', () => {
        const tree = renderList([suggestedTask('task-1')])

        const bulkActions = tree.root.findByType('SuggestedBulkActions')
        expect(bulkActions.props.projectId).toBe('project-1')
        expect(bulkActions.props.tasks.map(task => task.id)).toEqual(['task-1'])
    })

    test('hands the whole section to the bulk actions when there are several', () => {
        const tree = renderList([suggestedTask('task-1'), suggestedTask('task-2')])

        expect(tree.root.findByType('SuggestedBulkActions').props.tasks.map(task => task.id)).toEqual([
            'task-1',
            'task-2',
        ])
    })
})
