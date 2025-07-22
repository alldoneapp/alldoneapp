import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import ProjectMembersTag from '../../Tags/ProjectMembersTag'
import NavigationService from '../../../utils/NavigationService'
import { useSelector } from 'react-redux'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import { translate } from '../../../i18n/TranslationService'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'

export default function UserInvitationItem({ project }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)

    const onPress = () => {
        ContactsHelper.processURLProjectPeopleAdd(NavigationService, project.id, loggedUser.uid)
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.projectName}>
                <ColoredCircleSmall
                    size={16}
                    color={project.color}
                    isGuide={!!project.parentTemplateId}
                    containerStyle={{ margin: 4 }}
                    projectId={project.id}
                />
                <Text style={[styles.subtitle1, localStyles.title]} numberOfLines={1}>
                    {project.name}
                </Text>
            </View>
            <View style={localStyles.tags}>
                <ProjectMembersTag amount={project.userIds.length} />
            </View>
            <View>
                <Button
                    type={'ghost'}
                    icon={'folder-clasify'}
                    title={!mobile ? translate('Answer') : null}
                    onPress={onPress}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
    },
    projectName: {
        flex: 1,
        flexDirection: 'row',
    },
    title: {
        marginLeft: 4,
        color: colors.Text01,
    },
    tags: {
        paddingRight: 12,
        flexDirection: 'row',
    },
})
