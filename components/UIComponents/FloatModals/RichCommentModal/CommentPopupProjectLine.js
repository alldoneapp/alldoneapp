import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

// Width the popup's fixed expand + close buttons (CloseButton: 28 + 8 + 28, anchored to the
// popup's outer corner) reach into the content area, which starts 16px in from that corner.
const CLOSE_BUTTONS_CLEARANCE = 56

/**
 * The owning project's name, shown above the object row at the top of a comment popup (AT-2867).
 * It reads the project by the popup's own projectId — the project the object and its comments
 * live in — and subscribes to that one entry only, so a rename shows up without re-rendering
 * the popup for unrelated project writes. Renders nothing when the project is not one of the
 * user's projects (e.g. a global assistant), rather than an empty line.
 */
export default function CommentPopupProjectLine({ projectId }) {
    const project = useSelector(state => (projectId ? state.loggedUserProjectsMap?.[projectId] : undefined))

    if (!project || !project.name) return null

    const color = ProjectHelper.getProjectColorById(projectId)

    return (
        <View
            testID="comment-popup-project-line"
            style={localStyles.container}
            accessibilityLabel={`${translate('Project')}: ${project.name}`}
        >
            <ColoredCircleSmall
                size={12}
                color={color}
                isGuide={!!project.parentTemplateId}
                lineHeight={12}
                projectId={projectId}
                containerStyle={localStyles.dot}
            />
            <Text style={localStyles.name} numberOfLines={1} ellipsizeMode="tail">
                {project.name}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 28,
        marginBottom: 8,
        paddingRight: CLOSE_BUTTONS_CLEARANCE,
        width: '100%',
    },
    dot: {
        flexShrink: 0,
        marginRight: 8,
    },
    name: {
        ...styles.caption1,
        color: colors.Text03,
        flexShrink: 1,
        minWidth: 0,
    },
})
