import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import ProjectTag from '../../../Tags/ProjectTag'

export default function ProjectTagIndicator({ projectId }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const chatPath = `/projects/${projectId}/user/${loggedUserId}/chats/all`

    return (
        <View style={localStyles.container}>
            <ProjectTag
                projectId={projectId}
                shrinkTextToAmountOfLetter={smallScreenNavigation ? 1 : 8}
                style={{ backgroundColor: colors.Grey100 }}
                hideDots={smallScreenNavigation}
                path={chatPath}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderRadius: 100,
        position: 'absolute',
        right: 3,
        top: 3,
    },
})
