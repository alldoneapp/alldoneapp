import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import ProjectTag from '../../../Tags/ProjectTag'

/**
 * The project tag of a Last comment card's title line.
 *
 * AT-2902 — it used to sit absolutely positioned in the card's top-right corner, where it covered
 * the end of a long topic name. It now leads the title line and the topic name (or, on the pending
 * card, the send status) starts right after it, so it is rendered in flow and never shrinks: the
 * text next to it is what gives way and truncates.
 *
 * Renders nothing for a project the user cannot resolve (`ProjectTag` would dereference it), so a
 * pending send or a cached preview that names an unknown project still renders its title line.
 */
export default function ProjectTagIndicator({ projectId }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const project = useSelector(state => (projectId ? state.loggedUserProjectsMap?.[projectId] : null))

    if (!project) return null

    const chatPath = `/projects/${projectId}/user/${loggedUserId}/chats/all`

    return (
        <View style={localStyles.container} testID="last-comment-project-tag">
            <ProjectTag
                project={project}
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
        flexShrink: 0,
        marginRight: 6,
    },
})
