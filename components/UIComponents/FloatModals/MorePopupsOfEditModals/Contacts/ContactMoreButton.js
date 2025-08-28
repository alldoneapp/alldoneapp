import React, { useRef, useState } from 'react'
import { Keyboard } from 'react-native'
import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import { FEED_CONTACT_OBJECT_TYPE, FEED_USER_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import DeleteModalItem from './DeleteModalItem'
import { FORM_TYPE_EDIT, FORM_TYPE_NEW } from '../../../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import { useDispatch, useSelector } from 'react-redux'
import {
    removeModal,
    RICH_CREATE_TASK_MODAL_ID,
    storeModal,
    TEXT_FIELD_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import RichCreateTaskModal from '../../RichCreateTaskModal/RichCreateTaskModal'
import FollowingModalItem from './FollowingModalItem'
import PrivacyModal from '../../PrivacyModal/PrivacyModal'
import GenericModalItem from '../Common/GenericModalItem'
import Backend from '../../../../../utils/BackendBridge'
import ChangeTextFieldModal from '../../ChangeTextFieldModal'
import CopyLinkModalItem from '../Common/CopyLinkModalItem'
import { getDvMainTabLink } from '../../../../../utils/LinkingHelper'
import {
    setProjectContactEmail,
    setProjectContactPhone,
} from '../../../../../utils/backends/Contacts/contactsFirestore'

export default function ContactMoreButton({
    formType,
    projectId,
    contact,
    isMember,
    wrapperStyle,
    buttonStyle,
    savePhoneBeforeSaveContact,
    saveEmailBeforeSaveContact,
    dismissEditMode,
    disabled,
    inMentionModal,
    shortcut = 'M',
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const dispatch = useDispatch()
    const [showAddTask, setShowAddTask] = useState(false)
    const [showPrivacy, setShowPrivacy] = useState(false)
    const [showPhone, setShowPhone] = useState(false)
    const [showEmail, setShowEmail] = useState(false)
    const modalRef = useRef()

    const link = `${window.location.origin}${getDvMainTabLink(projectId, contact.uid, isMember ? 'users' : 'contacts')}`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const openPopup = (e, constant, setVisibilityModal) => {
        e?.preventDefault()
        e?.stopPropagation()
        Keyboard.dismiss()
        if (constant) storeModal(constant)
        dispatch(showFloatPopup())
        setVisibilityModal(true)
    }

    const hidePopups = (setVisibilityModal, modalId) => {
        if (modalId) removeModal(modalId)
        dispatch(hideFloatPopup())
        setVisibilityModal(false)
    }
    const delayHidePopups = (setVisibilityModal, modalId) => {
        setTimeout(() => {
            hidePopups(setVisibilityModal, modalId)
        })
    }

    const hideTaskPopup = () => {
        dismissModal()
        dismissEditMode?.()
    }

    const hidePrivacyPopup = (shouldDismissModal = false) => {
        hidePopups(setShowPrivacy)
        if (shouldDismissModal) {
            dismissModal()
            dismissEditMode?.()
        }
    }

    const savePhone = phone => {
        if (formType === FORM_TYPE_NEW) {
            savePhoneBeforeSaveContact?.(phone)
            dismissModal()
        } else {
            setProjectContactPhone(projectId, contact, contact.uid, phone, contact.phone)
            dismissModal()
            dismissEditMode?.()
        }
    }

    const saveEmail = email => {
        if (formType === FORM_TYPE_NEW) {
            saveEmailBeforeSaveContact?.(email)
            dismissModal()
        } else {
            setProjectContactEmail(projectId, contact, contact.uid, email, contact.email)
            dismissModal()
            dismissEditMode?.()
        }
    }

    const hidePhonePopup = () => {
        hidePopups(setShowPhone, TEXT_FIELD_MODAL_ID)
    }

    const hideEmailPopup = () => {
        hidePopups(setShowEmail, TEXT_FIELD_MODAL_ID)
    }

    const onCloseMainModal = () => {
        if (showAddTask) {
            setShowAddTask(false)
            removeModal(RICH_CREATE_TASK_MODAL_ID)
        }
        if (showPrivacy) {
            setShowPrivacy(false)
        }
        if (showPhone) {
            setShowPhone(false)
            removeModal(TEXT_FIELD_MODAL_ID)
        }
        if (showEmail) {
            setShowEmail(false)
            removeModal(TEXT_FIELD_MODAL_ID)
        }
    }

    const renderItems = () => {
        const list = []

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-addtask'}
                        icon={'check-square'}
                        text={'Add task'}
                        visibilityData={{
                            openPopup,
                            constant: RICH_CREATE_TASK_MODAL_ID,
                            visibilityFn: setShowAddTask,
                        }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <CopyLinkModalItem key={'mbtn-copy-link'} link={link} shortcut={shortcut} onPress={hideTaskPopup} />
                )
            })
        }

        if (!isMember && formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-privacy'}
                        icon={'unlock'}
                        text={'Privacy'}
                        visibilityData={{ openPopup, visibilityFn: setShowPrivacy }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (!isMember) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-phone'}
                        icon={'phone'}
                        text={'Phone'}
                        visibilityData={{ openPopup, constant: TEXT_FIELD_MODAL_ID, visibilityFn: setShowPhone }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (!isMember) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-email'}
                        icon={'mail'}
                        text={'Email'}
                        visibilityData={{ openPopup, constant: TEXT_FIELD_MODAL_ID, visibilityFn: setShowEmail }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <FollowingModalItem
                        key={'mbtn-following'}
                        projectId={projectId}
                        contact={contact}
                        isMember={isMember}
                        closeModal={hideTaskPopup}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <DeleteModalItem
                        key={'mbtn-delete'}
                        projectId={projectId}
                        contact={contact}
                        isMember={isMember}
                        onPress={dismissModal}
                        shortcut={shortcut}
                    />
                )
            })
        }

        return list
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            projectId={projectId}
            formType={formType}
            object={contact}
            objectType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut={shortcut}
            wrapperStyle={wrapperStyle}
            inMentionModal={inMentionModal}
            onCloseModal={onCloseMainModal}
            customModal={
                showAddTask ? (
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        sourceType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
                        sourceId={contact.uid}
                        closeModal={() => delayHidePopups(setShowAddTask, RICH_CREATE_TASK_MODAL_ID)}
                        triggerWhenCreateTask={hideTaskPopup}
                    />
                ) : showPrivacy ? (
                    <PrivacyModal
                        object={contact}
                        objectType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
                        projectId={projectId}
                        delayClosePopover={() => hidePrivacyPopup()}
                        closePopover={() => hidePrivacyPopup(true)}
                    />
                ) : showPhone ? (
                    <ChangeTextFieldModal
                        header={'Edit phone'}
                        subheader={'Type the phone of this person'}
                        label={'Phone'}
                        placeholder={'Type the phone number'}
                        closePopover={hidePhonePopup}
                        onSaveData={savePhone}
                        currentValue={contact.phone}
                    />
                ) : showEmail ? (
                    <ChangeTextFieldModal
                        header={'Edit email'}
                        subheader={'Type the email of this person'}
                        label={'Email'}
                        placeholder={'Type the email address'}
                        closePopover={hideEmailPopup}
                        onSaveData={saveEmail}
                        currentValue={contact.email}
                        validateFunction={this.validateEmail}
                    />
                ) : null
            }
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
