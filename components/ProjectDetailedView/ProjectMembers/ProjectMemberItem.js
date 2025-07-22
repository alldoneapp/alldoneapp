import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Button from '../../UIControls/Button'
import styles, { colors } from '../../styles/global'
import NavigationService from '../../../utils/NavigationService'
import store from '../../../redux/store'
import { setSelectedNavItem, showConfirmPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT } from '../../UIComponents/ConfirmPopup'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_USER_PROFILE } from '../../../utils/TabNavigationConstants'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

const ProjectMemberItem = ({ user, project }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const role = ProjectHelper.getUserRoleInProject(project.id, user.uid, user.role)
    const company = ProjectHelper.getUserCompanyInProject(project.id, user.uid, user.company)

    const onPressMember = () => {
        NavigationService.navigate('UserDetailedView', {
            contact: user,
            project: project,
        })
        store.dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
    }

    const userIsNormalUserInGuide = ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id)

    const onKickPress = () => {
        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT,
                object: {
                    userId: user.uid,
                    projectId: project.id,
                },
            })
        )
    }

    return (
        <View style={localStyles.container}>
            <TouchableOpacity onPress={onPressMember} style={[localStyles.container, { flex: 1 }]}>
                <View style={localStyles.userPhoto}>
                    <Image source={{ uri: user.photoURL }} style={localStyles.image} />
                </View>
                <View style={localStyles.userData}>
                    <Text style={[localStyles.userName, styles.body1]}>{user.displayName}</Text>
                    {(!!role || !!company) && (
                        <View style={localStyles.captionText}>
                            <Text style={[styles.caption2, { color: colors.Text03 }]}>{role}</Text>
                            {!!role && !!company && <View style={localStyles.separator} />}
                            <Text style={[styles.caption2, { color: colors.Text03 }]}>{company}</Text>
                        </View>
                    )}
                </View>
                {(!userIsNormalUserInGuide || loggedUserId === user.uid) && (
                    <View style={localStyles.buttonSection}>
                        <Button
                            type={'ghost'}
                            icon={'kick'}
                            title={!mobile ? translate('Kick user') : null}
                            buttonStyle={{ borderColor: colors.UtilityRed200 }}
                            titleStyle={{ color: colors.UtilityRed200 }}
                            onPress={onKickPress}
                        />
                    </View>
                )}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 64,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    userPhoto: {},
    image: {
        width: 40,
        height: 40,
        borderRadius: 100,
    },
    userData: {
        flex: 1,
        paddingTop: 2,
        marginLeft: 12,
        flexDirection: 'column',
        justifyContent: 'flex-start',
    },
    userName: {
        justifyContent: 'flex-start',
    },
    captionText: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    buttonSection: {
        marginLeft: 8,
    },
    separator: {
        width: 4,
        height: 4,
        marginHorizontal: 8,
        borderRadius: 50,
        backgroundColor: colors.Text03,
    },
})

export default ProjectMemberItem
