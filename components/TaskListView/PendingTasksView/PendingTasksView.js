import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import PendingTasksByProject from './PendingTasksByProject'

export default function PendingTasksView() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])

    return (
        <View
            style={[
                localStyles.container,
                mobile ? localStyles.containerForMobile : isMiddleScreen && localStyles.containerForTablet,
            ]}
        >
            <PendingTasksByProject project={project} inSelectedProject={true} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 104,
        backgroundColor: 'white',
    },
    containerForMobile: {
        paddingHorizontal: 16,
    },
    containerForTablet: {
        paddingHorizontal: 56,
    },
})
