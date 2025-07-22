import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import OpenTasksByProjectForAssistants from './OpenTaskViewForAssistants/OpenTasksByProjectForAssistants'
import OpenTasksByProject from './OpenTasksByProject'
import { resetLoadingData, setLaterTasksExpanded, setSomedayTasksExpanded } from '../../../redux/actions'

export default function OpenTasksViewSelectedProject() {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const projectId = useSelector(state => state.loggedUserProjects[selectedProjectIndex].id)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const isAssistant = useSelector(state => !!state.currentUser.temperature)

    useEffect(() => {
        dispatch(resetLoadingData())
        return () => {
            dispatch([resetLoadingData(), setLaterTasksExpanded(false), setSomedayTasksExpanded(false)])
        }
    }, [selectedProjectIndex, currentUserId])

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation
                    ? localStyles.containerForMobile
                    : isMiddleScreen && localStyles.containerForTablet,
            ]}
        >
            {isAssistant ? (
                <OpenTasksByProjectForAssistants
                    key={`${projectId}_${currentUserId}`}
                    projectIndex={selectedProjectIndex}
                />
            ) : (
                <OpenTasksByProject key={`${projectId}_${currentUserId}`} projectId={projectId} firstProject={true} />
            )}
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
