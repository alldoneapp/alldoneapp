import React from 'react'
import { StyleSheet, Text, Image, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import { ALL_PROJECTS_OPTION } from '../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import { isAutomaticProjectOption } from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

export default function ScopeTag({ selectedProject }) {
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    // Both leading picker rows are sentinels rather than projects: "All projects"
    // shows the user avatar, "Automatic" (AT-2306) the assistant icon.
    const isAutomatic = isAutomaticProjectOption(selectedProject.id)
    const project = isAutomatic || selectedProject.id === ALL_PROJECTS_OPTION ? null : selectedProject

    const shrinkText = text => {
        const textLimit = smallScreenNavigation ? 15 : isMiddleScreen ? 20 : 25
        const shrinkedText = shrinkTagText(text, textLimit)
        return shrinkedText
    }

    const textToShow = project ? project.name : isAutomatic ? translate('Automatic') : 'All projects'
    const shrinkedText = shrinkText(textToShow)

    return (
        <View style={localStyles.tag}>
            {project ? (
                <ColoredCircleSmall
                    size={12}
                    color={project.color}
                    isGuide={!!project.parentTemplateId}
                    containerStyle={{ marginRight: 8, marginLeft: 2 }}
                    projectId={project.id}
                />
            ) : isAutomatic ? (
                <Icon name="cpu" size={16} color={colors.Text03} style={localStyles.icon} />
            ) : (
                <Image style={localStyles.avatar} source={{ uri: photoURL }} />
            )}
            <Text style={localStyles.text}>{shrinkedText}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        paddingLeft: 2,
        paddingRight: 8,
        height: 24,
        marginTop: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 100,
        marginRight: 4,
    },
    icon: {
        marginLeft: 2,
        marginRight: 6,
    },
})
