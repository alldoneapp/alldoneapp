import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import ModernImage from '../../../utils/ModernImage'

export default function SelectedProjectEmptyInbox({ projectId, instanceKey }) {
    const thereAreLaterOpenTasksInProject = useSelector(state => state.thereAreLaterOpenTasks[projectId])
    const thereAreLaterEmptyGoalsInProject = useSelector(state => state.thereAreLaterEmptyGoals[projectId])
    const thereAreSomedayOpenTasksInProject = useSelector(state => state.thereAreSomedayOpenTasks[projectId])
    const thereAreSomedayEmptyGoalsInProject = useSelector(state => state.thereAreSomedayEmptyGoals[projectId])

    return (
        <View
            style={[
                localStyles.emptyInbox,
                (thereAreLaterOpenTasksInProject ||
                    thereAreLaterEmptyGoalsInProject ||
                    thereAreSomedayOpenTasksInProject ||
                    thereAreSomedayEmptyGoalsInProject) && {
                    marginTop: 32,
                },
            ]}
        >
            <ModernImage
                srcWebp={require('../../../web/images/illustrations/Empty-Inbox.webp')}
                fallback={require('../../../web/images/illustrations/Empty-Inbox.png')}
                style={{ flex: 1, width: '100%', maxWidth: 432 }}
                alt={'Empty inbox'}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    emptyInbox: {
        flex: 1,
        marginTop: 56,
        marginBottom: 32,
        alignItems: 'center',
    },
})
