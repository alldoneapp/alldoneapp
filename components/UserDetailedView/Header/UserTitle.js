import React from 'react'
import { Image, StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import styles, { colors } from '../../styles/global'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import ContactsHelper, { PHOTO_SIZE_50 } from '../../ContactsView/Utils/ContactsHelper'
import SocialText from '../../UIControls/SocialText/SocialText'
import store from '../../../redux/store'
import { setSelectedNavItem } from '../../../redux/actions'
import { DV_TAB_USER_PROFILE } from '../../../utils/TabNavigationConstants'

export default function UserTitle({ contact, project, isContact }) {
    const role = ProjectHelper.getUserRoleInProject(project.id, contact.uid, contact.role)
    const company = ProjectHelper.getUserCompanyInProject(project.id, contact.uid, contact.company)
    const additionalInfo = `${role} • ${company}`
    const mainInfo = `${contact.displayName}`

    const contactPhotoURL50 = ContactsHelper.getContactPhotoURL(contact, !isContact, PHOTO_SIZE_50)

    const navigateToProfile = () => {
        store.dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
    }

    return (
        <View style={{ height: 64, flex: 1 }}>
            <View style={localStyles.upperContainer} />
            <View style={localStyles.bottomContainer}>
                <View style={[localStyles.projectMarker, { backgroundColor: project.color }]}>
                    {contact.photoURL != null && contact.photoURL !== '' ? (
                        <Image source={{ uri: contactPhotoURL50 }} style={localStyles.userImage} />
                    ) : (
                        <View style={localStyles.userImage}>
                            <SVGGenericUser width={26} height={26} svgid={`ut_p_${contact.uid}_${project.index}`} />
                        </View>
                    )}
                </View>
                <View style={{ marginLeft: 12, maxWidth: '50%', flexWrap: 'nowrap' }}>
                    {isContact ? (
                        <SocialText
                            hashtagStyle={styles.title6}
                            mentionStyle={styles.title6}
                            emailStyle={styles.title6}
                            linkStyle={styles.title6}
                            normalStyle={localStyles.name}
                            numberOfLines={1}
                            projectId={project.id}
                            inTaskDetailedView={true}
                            showEllipsis={true}
                        >
                            {mainInfo}
                        </SocialText>
                    ) : (
                        <TouchableOpacity onPress={navigateToProfile}>
                            <Text style={localStyles.name}>{mainInfo}</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <View style={localStyles.additionalInfo}>
                    <Text style={[styles.caption2, { color: colors.Text03, marginLeft: 12 }]} numberOfLines={1}>
                        {additionalInfo}
                    </Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    upperContainer: {
        height: 32,
        backgroundColor: 'white',
    },
    bottomContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        backgroundColor: 'white',
        height: 32,
    },
    userImage: {
        height: 26,
        width: 26,
        borderRadius: 100,
        marginRight: 4,
        backgroundColor: colors.Gray400,
        overflow: 'hidden',
    },
    projectMarker: {
        width: 32,
        height: 32,
        borderRadius: 100,
        marginLeft: 1,
        padding: 3,
    },
    additionalInfo: {
        height: 24,
        justifyContent: 'center',
        alignSelf: 'flex-end',
        marginRight: 8,
    },
    name: {
        ...styles.title4,
        color: colors.Text01,
        whiteSpace: 'pre',
    },
})
