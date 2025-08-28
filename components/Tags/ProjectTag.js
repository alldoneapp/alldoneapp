import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import ColoredCircleSmall from '../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { setShowAllProjectsByTime } from '../../redux/actions'
import { updateShowAllProjectsByTime } from '../../utils/backends/Users/usersFirestore'

export default function ProjectTag({
    projectId,
    project,
    style,
    disabled,
    isMobile,
    path,
    shrinkTextToAmountOfLetter,
    hideDots,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const dispatch = useDispatch()

    const finalProject = project || ProjectHelper.getProjectById(projectId)

    const name =
        shrinkTextToAmountOfLetter > 0
            ? shrinkTagText(finalProject.name, shrinkTextToAmountOfLetter, hideDots)
            : finalProject.name

    const onPress = () => {
        dispatch(setShowAllProjectsByTime(false))
        updateShowAllProjectsByTime(loggedUserId, false)
        const finalPath = path || `/projects/${finalProject.id}/user/${loggedUserId}/tasks/open`
        URLTrigger.processUrl(NavigationService, finalPath)
    }

    return finalProject ? (
        <TouchableOpacity disabled={disabled} onPress={onPress}>
            <View style={[localStyles.container, isMobile && localStyles.containerMobile, style]}>
                <ColoredCircleSmall
                    size={12}
                    color={finalProject.color}
                    isGuide={!!finalProject.parentTemplateId}
                    containerStyle={{ marginHorizontal: 6 }}
                    lineHeight={20}
                    projectId={finalProject.id}
                />
                {!isMobile && <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{name}</Text>}
            </View>
        </TouchableOpacity>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    containerMobile: {
        width: 24,
        height: 24,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
