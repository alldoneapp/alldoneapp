import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import PendingTag from '../../Tags/PendingTag'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { showConfirmPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_CANCEL_PROJECT_INVITATION } from '../../UIComponents/ConfirmPopup'
import { DV_TAB_PROJECT_TEAM_MEMBERS } from '../../../utils/TabNavigationConstants'
import { useDispatch, useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

const ProjectInvitation = ({ invitation, project }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dispatch = useDispatch()

    const onCancelInvitation = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_CANCEL_PROJECT_INVITATION,
                object: {
                    userEmail: invitation.userEmail,
                    project: project,
                    navigation: DV_TAB_PROJECT_TEAM_MEMBERS,
                    mainNavigation: 'ProjectDetailedView',
                },
            })
        )
    }

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.container, { flex: 1 }]}>
                <View style={localStyles.userPhoto}>
                    <SVGGenericUser width={40} height={40} svgid={`gu_p_${invitation.userEmail}_${project.index}`} />
                </View>
                <View style={localStyles.userData}>
                    <Text style={[localStyles.userName, styles.body1]}>{invitation.userEmail}</Text>
                </View>
                <View style={localStyles.buttonSection}>
                    <PendingTag />
                    <Button
                        type={'ghost'}
                        icon={'x'}
                        title={!mobile ? translate('Cancel') : null}
                        buttonStyle={{ borderColor: colors.UtilityRed200, marginLeft: 8 }}
                        titleStyle={{ color: colors.UtilityRed200 }}
                        onPress={onCancelInvitation}
                    />
                </View>
            </View>
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
    userPhoto: {
        width: 40,
        height: 40,
        borderRadius: 100,
        overflow: 'hidden',
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
        flexDirection: 'row',
        alignItems: 'center',
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

export default ProjectInvitation
