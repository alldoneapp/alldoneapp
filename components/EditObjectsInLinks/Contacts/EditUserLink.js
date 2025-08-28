import React, { useEffect, useRef, useState } from 'react'
import Backend from '../../../utils/BackendBridge'
import NavigationService from '../../../utils/NavigationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { Image, StyleSheet, View } from 'react-native'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import styles, { colors } from '../../styles/global'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import SaveButton from '../Common/SaveButton'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import ContactInfoWrapper from '../../NewObjectsInMentions/Contacts/ContactInfoWrapper'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_USER_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import ContactMoreButton from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Contacts/ContactMoreButton'
import { FORM_TYPE_EDIT } from '../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import { checkDVLink, getDvMainTabLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { getPathname } from '../../Tags/LinkTag'
import { useSelector } from 'react-redux'
import { setUserHighlightInProject, setUserPrivacyInProject } from '../../../utils/backends/Users/usersFirestore'

export default function EditUserLink({ projectId, containerStyle, contactData, closeModal, objectUrl }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [contact, setContact] = useState(contactData)
    const project = ProjectHelper.getProjectById(projectId)
    const inputText = useRef()

    const cleanedName = contact.displayName.trim()

    useEffect(() => {
        inputText?.current?.focus()
    }, [])

    useEffect(() => {
        const updatedData = { ...contactData }
        updatedData.hasStar = ProjectHelper.getUserHighlightInProject(project.index, updatedData)
        ContactsHelper.getAndAssignUserPrivacy(project.index, updatedData)
        setContact(updatedData)
    }, [contactData])

    const onChangeText = displayName => {
        setContact(contact => ({ ...contact, displayName }))
    }

    const setInfo = ({ role, company, description }) => {
        ProjectHelper.setUserInfoInProject(
            project.id,
            project.index,
            contact.uid,
            company.trim(),
            role.trim(),
            description.trim()
        )

        closeModal()
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        setUserPrivacyInProject(project, contact, isPrivate, isPublicFor)

        closeModal()
    }

    const setColor = color => {
        setUserHighlightInProject(project, contact, color)

        closeModal()
    }

    const openDV = () => {
        closeModal()

        setTimeout(() => {
            checkDVLink('people')
            const linkUrl =
                objectUrl != null ? getPathname(objectUrl) : getDvMainTabLink(projectId, contactData.uid, 'users')
            URLTrigger.processUrl(NavigationService, linkUrl)
        }, 400)
    }

    const userIsLoggedUser = contactData && loggedUserId === contactData.uid
    const loggedUserCanUpdateObject = userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return !contact ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <View style={localStyles.userPhoto}>
                    {contact.photoURL != null && contact.photoURL !== '' ? (
                        <Image source={{ uri: contact.photoURL }} style={localStyles.photoShape} />
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
                        disabledEdition={true}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton onPress={openDV} disabled={!cleanedName} />

                    {loggedUserCanUpdateObject && (
                        <ContactInfoWrapper
                            contact={contact}
                            projectId={projectId}
                            setInfo={setInfo}
                            disabled={!cleanedName}
                        />
                    )}

                    {loggedUserCanUpdateObject && (
                        <PrivacyWrapper
                            object={contact}
                            objectType={FEED_USER_OBJECT_TYPE}
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
                            isMember={true}
                            disabled={!cleanedName}
                            dismissEditMode={closeModal}
                            inMentionModal={true}
                        />
                    )}
                </View>
                <View style={localStyles.buttonsRight}>
                    <SaveButton icon={'x'} onPress={closeModal} />
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
