import React from 'react'
import renderer from 'react-test-renderer'

// AT-2341: the DV used to render the calendar chip twice — once inline in front of the task name
// (SocialText -> Content -> LeftTagsAndIcons, which still does it) and once again in this metadata
// row. On mobile the duplicate pushed the metadata row onto an extra line for no information gain.

const mockStoreState = {
    loggedUser: { uid: 'user-1', sidebarExpanded: false },
    isMiddleScreen: false,
    smallScreenNavigation: true,
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockStoreState),
}))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: () => ({ id: 'project-1', name: 'Project' }),
    checkIfLoggedUserIsNormalUserInGuide: () => false,
}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    OPEN_STEP: 'open',
    RECURRENCE_NEVER: 'never',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))

// Every child of the row is stubbed; this suite is about which children the row renders.
jest.mock('../../../components/Tags/CalendarTag', () => {
    const React = require('react')
    const { View } = require('react-native')
    const CalendarTag = props => <View testID="CalendarTag" {...props} />
    return CalendarTag
})
jest.mock('../../../components/Tags/TaskRecurrence', () => {
    const React = require('react')
    const { View } = require('react-native')
    const TaskRecurrence = props => <View testID="TaskRecurrence" {...props} />
    return TaskRecurrence
})
jest.mock('../../../components/Tags/TaskEstimation', () => {
    const React = require('react')
    const { View } = require('react-native')
    const TaskEstimation = props => <View testID="TaskEstimation" {...props} />
    return TaskEstimation
})
jest.mock('../../../components/Tags/PrivacyTag', () => {
    const React = require('react')
    const { View } = require('react-native')
    const PrivacyTag = props => <View testID="PrivacyTag" {...props} />
    return PrivacyTag
})
jest.mock('../../../components/Tags/ProjectTag', () => {
    const React = require('react')
    const { View } = require('react-native')
    const ProjectTag = props => <View testID="ProjectTag" {...props} />
    return ProjectTag
})
jest.mock('../../../components/Tags/TaskIdTag', () => {
    const React = require('react')
    const { View } = require('react-native')
    const TaskIdTag = props => <View testID="TaskIdTag" {...props} />
    return TaskIdTag
})
jest.mock('../../../components/UIControls/CopyLinkButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    const CopyLinkButton = props => <View testID="CopyLinkButton" {...props} />
    return CopyLinkButton
})
jest.mock('../../../components/UIControls/OpenInNewWindowButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    const OpenInNewWindowButton = props => <View testID="OpenInNewWindowButton" {...props} />
    return OpenInNewWindowButton
})
jest.mock('../../../components/UIControls/DvBotButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    const DvBotButton = props => <View testID="DvBotButton" {...props} />
    return DvBotButton
})
jest.mock('../../../components/UIControls/DvSearchButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    const DvSearchButton = props => <View testID="DvSearchButton" {...props} />
    return DvSearchButton
})

import TagList from '../../../components/TaskDetailedView/Header/TagList'
import CalendarTag from '../../../components/Tags/CalendarTag'
import ProjectTag from '../../../components/Tags/ProjectTag'

const calendarTask = {
    id: 'task-1',
    userId: 'user-1',
    userIds: ['user-1'],
    humanReadableId: 'AT-1',
    recurrence: 'never',
    estimations: { open: 0 },
    inDone: false,
    calendarData: {
        eventId: 'event-1',
        start: { dateTime: '2026-08-17T17:00:00.000Z' },
        end: { dateTime: '2026-08-17T18:00:00.000Z' },
    },
}

describe('Task DV TagList (AT-2341)', () => {
    it('does not duplicate the calendar chip that already leads the task name', () => {
        const tree = renderer.create(<TagList projectId="project-1" task={calendarTask} />)

        expect(tree.root.findAllByType(CalendarTag)).toHaveLength(0)
        // Sanity check that the row itself still rendered, so the assertion above is meaningful.
        expect(tree.root.findAllByType(ProjectTag)).toHaveLength(1)
    })
})
