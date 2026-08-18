import React from 'react'
import { StyleSheet, View } from 'react-native'

import AddTaskTag from '../../Tags/AddTaskTag'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { AUTOMATIC_PROJECT_OPTION } from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

/**
 * The centered "Add task" call to action on the all-projects empty inbox
 * (AT-2306). When the day is done, the screen's only job is to make starting
 * the next thing easy, so this sits directly under the congrats headline and
 * above the project list, which stays as the "I know exactly where this goes"
 * shortcut.
 *
 * It opens the same add-task popup as the All Projects line and defaults to the
 * same "Automatic" project option — there is no project in context here either.
 */
export default function AllProjectsEmptyInboxAddTask() {
    return (
        <View style={localStyles.container}>
            <AddTaskTag
                projectId={AUTOMATIC_PROJECT_OPTION}
                sourceType={FEED_TASK_OBJECT_TYPE}
                expandTaskListIfNeeded={true}
                showProjectSelector={true}
                primary={true}
                large={true}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
})
