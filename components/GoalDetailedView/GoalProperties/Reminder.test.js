import React from 'react'
import renderer from 'react-test-renderer'

import Reminder from './Reminder'

const mockUpdateGoalAssigneeReminderDate = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('./ReminderWrapper', () => 'ReminderWrapper')
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        updateGoalAssigneeReminderDate: (...args) => mockUpdateGoalAssigneeReminderDate(...args),
    },
}))

describe('goal detail reminder write', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('passes the rendered goal so no server reread precedes the write', () => {
        const goal = { id: 'goal-1', assigneesReminderDate: { 'user-1': 100 } }
        const tree = renderer.create(<Reminder goal={goal} projectId="project-1" />)

        tree.root.findByType('ReminderWrapper').props.updateReminder(4242)

        expect(mockUpdateGoalAssigneeReminderDate).toHaveBeenCalledWith('project-1', 'goal-1', 'user-1', 4242, goal)
        tree.unmount()
    })
})
