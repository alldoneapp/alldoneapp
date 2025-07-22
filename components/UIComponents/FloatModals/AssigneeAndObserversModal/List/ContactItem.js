import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../../../styles/global'
import ContactsHelper, { PHOTO_SIZE_50 } from '../../../../ContactsView/Utils/ContactsHelper'
import SVGGenericUser from '../../../../../assets/svg/SVGGenericUser'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import ObjectHeaderParser from '../../../../Feeds/TextParser/ObjectHeaderParser'
import { useSelector } from 'react-redux'
import { ASSIGNEE_TAB } from '../Header/Header'
import CheckMark from './CheckMark'
import MemberTag from '../../../../Tags/MemberTag'
import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../../../Workstreams/WorkstreamHelper'
import Icon from '../../../../Icon'
import SocialText from '../../../../UIControls/SocialText/SocialText'
import { translate } from '../../../../../i18n/TranslationService'

export default function ContactItem({
    tab = ASSIGNEE_TAB,
    onSelectContact,
    projectIndex,
    contact,
    isActive,
    isHovered,
    itemsComponentsRefs,
}) {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isWorkstream = contact.uid.startsWith(WORKSTREAM_ID_PREFIX)
    const project = loggedUserProjects[projectIndex]

    const getContactInfo = contact => {
        const role = ProjectHelper.getUserRoleInProject(project.id, contact.uid, contact.role)
        const company = ProjectHelper.getUserCompanyInProject(project.id, contact.uid, contact.company)
        const description = ProjectHelper.getUserDescriptionInProject(
            project.id,
            contact.uid,
            contact.description,
            contact.extendedDescription,
            true
        )

        return !role && !company && !description
            ? translate('No further info available')
            : `${role ? role : ''}${role && (company || description) ? ' • ' : ''}${company ? company : ''}${
                  company && description ? ' • ' : ''
              }${description ? description : ''}`
    }

    const onPress = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        onSelectContact(contact, tab)
    }

    const { uid, displayName } = contact
    const isMember = !contact.hasOwnProperty('recorderUserId') && !contact.hasOwnProperty('userIds')
    const contactPhotoURL50 = ContactsHelper.getContactPhotoURL(contact, isMember, PHOTO_SIZE_50)
    const projectId = loggedUserProjects[projectIndex].id

    return (
        <View key={uid} ref={ref => (itemsComponentsRefs.current[uid] = ref)}>
            <TouchableOpacity
                key={uid}
                style={[localStyles.userContainer, isHovered ? localStyles.hoverUserContainer : null]}
                onPress={onPress}
                accessible={false}
            >
                <View>
                    <View style={[localStyles.userPhoto, isActive || isHovered ? localStyles.activeAvatar : null]}>
                        {isWorkstream ? (
                            <Icon size={24} name="workstream" color={colors.Text03} />
                        ) : contact.photoURL != null && contact.photoURL !== '' ? (
                            <View>
                                <Image
                                    source={{ uri: contactPhotoURL50 }}
                                    style={isActive || isHovered ? localStyles.avatarCircle : localStyles.avatar}
                                />
                            </View>
                        ) : (
                            <SVGGenericUser
                                width={isActive || isHovered ? 28 : 32}
                                height={isActive || isHovered ? 28 : 32}
                                svgid={`ci_p_${contact.uid}_${projectIndex}`}
                            />
                        )}
                    </View>
                    {isActive && <CheckMark style={localStyles.checkMark} />}
                </View>

                <View style={localStyles.textContainer}>
                    <SocialText
                        style={[localStyles.name, isHovered ? localStyles.hoverName : null]}
                        numberOfLines={1}
                        projectId={projectId}
                        showEllipsis={true}
                    >
                        {contact.uid === DEFAULT_WORKSTREAM_ID ? translate(displayName) : displayName}
                    </SocialText>

                    <ObjectHeaderParser
                        text={isWorkstream ? contact.description : getContactInfo(contact)}
                        projectId={projectId}
                        entryExternalStyle={localStyles.info}
                        containerExternalStyle={localStyles.infoContainer}
                        inMentionModalDescription={true}
                        dotsBackgroundColor={{ backgroundColor: colors.Secondary400 }}
                        maxHeight={20}
                        shortTags={true}
                    />
                </View>

                {isMember && (
                    <View>
                        <MemberTag
                            style={{ height: 20 }}
                            icon={'user'}
                            iconSize={14}
                            text={'Member'}
                            textStyle={localStyles.memberTagText}
                            isMobile={mobile}
                        />
                    </View>
                )}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    userContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 8,
    },
    hoverUserContainer: {
        backgroundColor: '#1e2a51',
        borderRadius: 4,
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
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
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
    hoverName: {
        color: colors.Primary100,
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
    checkMark: {
        position: 'absolute',
        right: -2,
        bottom: -2,
    },
    memberTagText: {
        ...styles.caption1,
        fontFamily: 'Roboto-Regular',
        color: colors.UtilityLime300,
    },
})
