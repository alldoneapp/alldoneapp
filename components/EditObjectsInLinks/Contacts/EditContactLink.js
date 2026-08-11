import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import Backend from '../../../utils/BackendBridge'
import NavigationService from '../../../utils/NavigationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { Image, StyleSheet, View } from 'react-native'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import styles, { colors } from '../../styles/global'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import SaveButton from '../Common/SaveButton'
import ContactsHelper, { PHOTO_SIZE_300, PHOTO_SIZE_50 } from '../../ContactsView/Utils/ContactsHelper'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import ContactInfoWrapper from '../../NewObjectsInMentions/Contacts/ContactInfoWrapper'
import PictureWrapper from '../../NewObjectsInMentions/Contacts/PictureWrapper'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_CONTACT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import HelperFunctions from '../../../utils/HelperFunctions'
import ContactMoreButton from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Contacts/ContactMoreButton'
import { FORM_TYPE_EDIT } from '../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import { checkDVLink, getDvMainTabLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { getPathname } from '../../Tags/LinkTag'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'
import {
    setProjectContactHighlight,
    setProjectContactName,
    setProjectContactPicture,
    setProjectContactPrivacy,
} from '../../../utils/backends/Contacts/contactsFirestore'
import { object } from 'prop-types'

export default function EditContactLink({ projectId, containerStyle, contactData, closeModal, objectUrl }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const [contact, setContact] = useState(contactData)
    const contactPhotoURL50 = ContactsHelper.getContactPhotoURL(contactData, false, PHOTO_SIZE_50)
    const project = ProjectHelper.getProjectById(projectId)
    const inputText = useRef()

    const cleanedName = contact.displayName.trim()

    useEffect(() => {
        inputText?.current?.focus()
    }, [])

    const needBeUpdated = () => {
        return contact.displayName.trim() !== contactData.displayName.trim()
    }

    const onChangeText = displayName => {
        setContact(contact => ({ ...contact, displayName }))
    }

    const setName = (openDetails = false) => {
        setProjectContactName(projectId, contact, contact.uid, contact.displayName.trim(), contactData.displayName)

        if (openDetails) {
            openDV()
        } else {
            closeModal()
        }
    }

    const setInfo = ({ role, company, description }) => {
        ProjectHelper.setContactInfoInProject(
            project.index,
            contact,
            contact.uid,
            company.trim(),
            contact.company,
            role.trim(),
            contact.role,
            TasksHelper.getTaskNameWithoutMeta(description.trim()),
            contact.description
        )

        closeModal()
    }

    const setPicture = async value => {
        await setProjectContactPicture(projectId, contact, contact.uid, value)

        closeModal()
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        setProjectContactPrivacy(projectId, contact, contact.uid, isPrivate, isPublicFor)

        closeModal()
    }

    const setColor = color => {
        setProjectContactHighlight(project.id, contact, contact.uid, color)

        closeModal()
    }

    const openDV = () => {
        closeModal()

        setTimeout(() => {
            checkDVLink('people')
            const linkUrl =
                objectUrl != null ? getPathname(objectUrl) : getDvMainTabLink(projectId, contactData.uid, 'contacts')
            URLTrigger.processUrl(NavigationService, linkUrl)
        }, 400)
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            needBeUpdated() ? setName() : closeModal()
        }
    }

    const loggedUserIsCreator = contact && loggedUser.uid === contact.recorderUserId
    const loggedUserCanUpdateObject =
        loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return !contact ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <View style={localStyles.userPhoto}>
                    {contact.photoURL != null && contact.photoURL !== '' ? (
                        <Image source={{ uri: contactPhotoURL50 }} style={localStyles.photoShape} />
                    ) : (
                        <SVGGenericUser width={24} height={24} svgid={`ci_p_d_c_${contact.uid}_${projectId}`} />
                    )}
                </View>
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={'Type to edit the contact'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={contact.displayName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                        disabledEdition={!loggedUserCanUpdateObject}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton onPress={needBeUpdated() ? () => setName(true) : openDV} disabled={!cleanedName} />

                    {loggedUserCanUpdateObject && (
                        <ContactInfoWrapper
                            contact={contact}
                            projectId={projectId}
                            setInfo={setInfo}
                            disabled={!cleanedName}
                        />
                    )}

                    {loggedUserCanUpdateObject && (
                        <PictureWrapper contact={contact} setPicture={setPicture} disabled={!cleanedName} />
                    )}

                    {loggedUserCanUpdateObject && (
                        <PrivacyWrapper
                            object={contact}
                            objectType={FEED_CONTACT_OBJECT_TYPE}
                            projectId={projectId}
                            setPrivacy={setPrivacy}
                            disabled={!cleanedName}
                        />
                    )}

                    {loggedUserCanUpdateObject && (
                        <HighlightWrapper object={contact} setColor={setColor} disabled={!cleanedName} />
                    )}

                    {loggedUserCanUpdateObject && (
                        <ContactMoreButton
                            formType={FORM_TYPE_EDIT}
                            projectId={projectId}
                            contact={contact}
                            isMember={false}
                            disabled={!cleanedName}
                            dismissEditMode={closeModal}
                            inMentionModal={true}
                        />
                    )}
                </View>
                <View style={localStyles.buttonsRight}>
                    <SaveButton
                        icon={(!needBeUpdated() || !cleanedName) && 'x'}
                        onPress={needBeUpdated() && loggedUserCanUpdateObject ? () => setName() : closeModal}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    buttonsRight: {},
    photoShape: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    userPhoto: {
        width: 24,
        height: 24,
        borderRadius: 100,
        overflow: 'hidden',
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
