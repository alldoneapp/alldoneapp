import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import PlusButton from '../Common/PlusButton'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME, MENTION_MODAL_CONTACTS_TAB } from '../../Feeds/CommentsTextInput/textInputHelper'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import ContactsHelper, { PHOTO_SIZE_300, PHOTO_SIZE_50 } from '../../ContactsView/Utils/ContactsHelper'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import PictureWrapper from './PictureWrapper'
import ContactInfoWrapper from './ContactInfoWrapper'
import { FEED_CONTACT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import Icon from '../../Icon'
import Backend from '../../../utils/BackendBridge'
import { setSelectedNavItem, startLoadingData, stopLoadingData } from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { useDispatch } from 'react-redux'
import HelperFunctions from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import store from '../../../redux/store'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import { DV_TAB_CONTACT_PROPERTIES } from '../../../utils/TabNavigationConstants'
import { addContactToProject } from '../../../utils/backends/Contacts/contactsFirestore'

export default function CreateContact({ projectId, containerStyle, selectItemToMention, modalId, mentionText }) {
    const dispatch = useDispatch()
    const [sendingData, setSendingData] = useState(false)
    const [contact, setContact] = useState(ContactsHelper.getDefaultContactInfo())
    const inputText = useRef()

    const cleanedName = contact?.displayName?.trim()

    useEffect(() => {
        inputText?.current?.focus()
    }, [])

    const onChangeText = displayName => {
        setContact(contact => ({ ...contact, displayName }))
    }

    const setInfo = ({ role, company, description }) => {
        setContact(contact => ({
            ...contact,
            role,
            company,
            extendedDescription: description,
            description: TasksHelper.getTaskNameWithoutMeta(description),
        }))
    }

    const setPicture = photoURL => {
        setContact(contact => ({ ...contact, photoURL }))
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        setContact(contact => ({ ...contact, isPrivate, isPublicFor }))
    }

    const setColor = color => {
        setContact(contact => ({ ...contact, hasStar: color }))
    }

    const addProjectContact = async (openDetails = false) => {
        const newContact = { ...contact }
        newContact.displayName = newContact.displayName.trim()

        if (newContact.displayName.length > 0) {
            dispatch(startLoadingData())
            setSendingData(true)

            if (newContact.photoURL !== '' && newContact.photoURL != null) {
                const src =
                    typeof newContact.photoURL === 'string'
                        ? newContact.photoURL
                        : URL.createObjectURL(newContact.photoURL)

                const resized50 = (await HelperFunctions.resizeImage(src, PHOTO_SIZE_50)).uri
                const resized300 = (await HelperFunctions.resizeImage(src, PHOTO_SIZE_300)).uri

                newContact.photoURL = await HelperFunctions.convertURItoBlob(newContact.photoURL)
                newContact.photoURL50 = await HelperFunctions.convertURItoBlob(resized50)
                newContact.photoURL300 = await HelperFunctions.convertURItoBlob(resized300)
            }

            await addContactToProject(projectId, newContact, contactDB => {
                dispatch(stopLoadingData())
                setSendingData(false)

                if (selectItemToMention) {
                    selectItemToMention(contactDB, MENTION_MODAL_CONTACTS_TAB, projectId)
                }

                if (openDetails) {
                    NavigationService.navigate('ContactDetailedView', {
                        contact: contactDB,
                        project: { id: projectId, index: ProjectHelper.getProjectIndexById(projectId) },
                    })
                    store.dispatch(setSelectedNavItem(DV_TAB_CONTACT_PROPERTIES))
                }
            })
        }
    }

    const enterKeyAction = () => {
        const { mentionModalStack } = store.getState()
        if (
            mentionModalStack[0] === modalId &&
            !exitsOpenModals([MENTION_MODAL_ID, COMMENT_MODAL_ID, TAGS_INTERACTION_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID])
        ) {
            addProjectContact()
        }
    }

    return !contact ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={translate('Type to add contact')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={mentionText || contact.extendedName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        disabledEdition={sendingData}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    {/*<OpenButton onPress={open} disabled={!cleanedName || sendingData} />*/}

                    <ContactInfoWrapper
                        contact={contact}
                        projectId={projectId}
                        setInfo={setInfo}
                        disabled={!cleanedName || sendingData}
                    />

                    <PictureWrapper contact={contact} setPicture={setPicture} disabled={!cleanedName || sendingData} />

                    <PrivacyWrapper
                        object={contact}
                        objectType={FEED_CONTACT_OBJECT_TYPE}
                        projectId={projectId}
                        setPrivacy={setPrivacy}
                        disabled={!cleanedName || sendingData}
                    />

                    <HighlightWrapper object={contact} setColor={setColor} disabled={!cleanedName || sendingData} />
                </View>
                <View style={localStyles.buttonsRight}>
                    <PlusButton
                        onPress={() => addProjectContact()}
                        disabled={!cleanedName || sendingData}
                        modalId={modalId}
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
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
