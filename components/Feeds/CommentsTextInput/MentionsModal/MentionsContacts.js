import React, { useEffect } from 'react'
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import ContactsHelper, { PHOTO_SIZE_50 } from '../../../ContactsView/Utils/ContactsHelper'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { MENTION_MODAL_CONTACTS_TAB } from '../textInputHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ObjectHeaderParser from '../../TextParser/ObjectHeaderParser'
import SocialText from '../../../UIControls/SocialText/SocialText'
import { getAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function MentionsContacts({
    projectId,
    selectUserToMention,
    users,
    activeUserIndex,
    usersComponentsRefs,
    activeItemRef,
    externalContainerStyle,
}) {
    const getContactInfo = contact => {
        const role = ProjectHelper.getUserRoleInProject(projectId, contact.uid, contact.role)
        const company = ProjectHelper.getUserCompanyInProject(projectId, contact.uid, contact.company)
        const description = ProjectHelper.getUserDescriptionInProject(
            projectId,
            contact.uid,
            contact.description,
            contact.extendedDescription,
            !contact.isAssistant
        )

        return !role && !company && !description
            ? ''
            : `${role ? role : ''}${role && (company || description) ? ' • ' : ''}${company ? company : ''}${
                  company && description ? ' • ' : ''
              }${description ? description : ''}`
    }

    useEffect(() => {
        if (activeItemRef) {
            const activeUserId = users[activeUserIndex] ? users[activeUserIndex].uid : ''
            if (activeUserId) {
                activeItemRef.current = usersComponentsRefs.current[activeUserId]
            }
        }
    }, [activeUserIndex])

    return (
        <View style={externalContainerStyle}>
            {users.map(user => {
                const { uid, displayName } = user
                const { uid: activeUserId } = users[activeUserIndex] || { uid: '' }
                const isMember = !user.recorderUserId && !user.isAssistant
                const contactPhotoURL50 = ContactsHelper.getContactPhotoURL(user, isMember, PHOTO_SIZE_50)
                const info = getContactInfo(user)

                return (
                    <TouchableOpacity
                        key={uid}
                        ref={ref => (usersComponentsRefs.current[uid] = ref)}
                        style={[
                            localStyles.userContainer,
                            uid === activeUserId ? localStyles.activeUserContainer : null,
                        ]}
                        onPress={() => {
                            selectUserToMention(user, MENTION_MODAL_CONTACTS_TAB, projectId)
                        }}
                    >
                        <View style={[localStyles.userPhoto, uid === activeUserId ? localStyles.activeAvatar : null]}>
                            {!!contactPhotoURL50 ? (
                                <View>
                                    <Image
                                        source={{ uri: contactPhotoURL50 }}
                                        style={uid === activeUserId ? localStyles.avatarCircle : localStyles.avatar}
                                    />
                                </View>
                            ) : (
                                <SVGGenericUser
                                    width={uid === activeUserId ? 28 : 32}
                                    height={uid === activeUserId ? 28 : 32}
                                    svgid={`ci_p_${user.uid}_${projectId}`}
                                />
                            )}
                        </View>

                        <View style={localStyles.textContainer}>
                            <SocialText
                                style={[localStyles.name, uid === activeUserId ? localStyles.activeName : null]}
                                numberOfLines={1}
                                projectId={projectId}
                            >
                                {displayName}
                            </SocialText>

                            {!!info && (
                                <ObjectHeaderParser
                                    text={info}
                                    projectId={projectId}
                                    entryExternalStyle={localStyles.info}
                                    containerExternalStyle={localStyles.infoContainer}
                                    inMentionModalDescription={true}
                                    dotsBackgroundColor={{ backgroundColor: colors.Secondary400 }}
                                    maxHeight={20}
                                    shortTags={true}
                                />
                            )}
                        </View>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    userContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
    },
    activeUserContainer: {
        backgroundColor: colors.Primary300,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityBlue150,
        borderStyle: 'dashed',
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 100,
    },
    avatarCircle: {
        width: 28,
        height: 28,
    },
    userPhoto: {
        width: 32,
        height: 32,
        borderRadius: 100,
        overflow: 'hidden',
        marginTop: 2,
    },
    activeAvatar: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    textContainer: {
        flex: 1,
    },
    name: {
        ...styles.subtitle1,
        color: '#FFFFFF',
        marginLeft: 8,
    },
    activeName: {
        color: '#FFFFFF',
    },
    info: {
        ...styles.caption2,
        color: colors.Text03,
    },
    infoContainer: {
        maxHeight: 20,
        marginLeft: 8,
        overflow: 'hidden',
    },
})
