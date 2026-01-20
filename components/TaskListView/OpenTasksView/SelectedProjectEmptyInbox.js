import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import ModernImage from '../../../utils/ModernImage'

export default function SelectedProjectEmptyInbox({ projectId, instanceKey }) {
    const thereAreLaterOpenTasksInProject = useSelector(state => state.thereAreLaterOpenTasks[projectId])
    const thereAreLaterEmptyGoalsInProject = useSelector(state => state.thereAreLaterEmptyGoals[projectId])
    const thereAreSomedayOpenTasksInProject = useSelector(state => state.thereAreSomedayOpenTasks[projectId])
    const thereAreSomedayEmptyGoalsInProject = useSelector(state => state.thereAreSomedayEmptyGoals[projectId])

    const randomImage = React.useMemo(() => {
        const images = [
            require('../../../assets/anna_tasks_done_01.png'),
            require('../../../assets/anna_tasks_done_02.png'),
            require('../../../assets/anna_tasks_done_03.png'),
        ]
        const randomIndex = Math.floor(Math.random() * images.length)
        return images[randomIndex]
    }, [])

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
                srcWebp={randomImage}
                fallback={randomImage}
                style={{ flex: 1, width: '100%', maxWidth: 432, borderRadius: 16 }}
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
