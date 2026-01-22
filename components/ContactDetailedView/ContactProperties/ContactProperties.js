import React, { Component } from 'react'
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import store from '../../../redux/store'
import PropTypes from 'prop-types'
import Popover from 'react-tiny-popover'

import UserPropertiesHeader from '../../UserDetailedView/UserProperties/UserPropertiesHeader'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Icon from '../../Icon'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { Picture } from '../../ContactsView/EditContact'
import ChangeTextFieldModal from '../../UIComponents/FloatModals/ChangeTextFieldModal'
import ChangeContactInfoModal from '../../UIComponents/FloatModals/ChangeContactInfoModal'
import HelperFunctions from '../../../utils/HelperFunctions'
import ImagePickerModal from '../../UIComponents/FloatModals/ImagePickerModal'
import { showConfirmPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_PROJECT_CONTACT } from '../../UIComponents/ConfirmPopup'
import URLsContacts, { URL_CONTACT_DETAILS_PROPERTIES } from '../../../URLSystem/Contacts/URLsContacts'
import ContactsHelper, { PHOTO_SIZE_300, PHOTO_SIZE_50 } from '../../ContactsView/Utils/ContactsHelper'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_CONTACTS_TYPE } from '../../Followers/FollowerConstants'
import { DV_TAB_CONTACT_PROPERTIES, DV_TAB_ROOT_CONTACTS } from '../../../utils/TabNavigationConstants'
import PrivacyButton from '../../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import { FEED_CONTACT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import HighlightButton from '../../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import SharedHelper from '../../../utils/SharedHelper'
import { translate } from '../../../i18n/TranslationService'
import ObjectRevisionHistory from '../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'
import {
    setProjectContactEmail,
    setProjectContactPhone,
    setProjectContactPicture,
    setProjectContactLinkedInUrl,
    enrichContactViaLinkedIn,
} from '../../../utils/backends/Contacts/contactsFirestore'
import ContactStatusProperty from '../../UIComponents/FloatModals/ChangeContactStatusModal/ContactStatusProperty'
import RichCreateTaskModal from '../../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import { popoverToSafePosition } from '../../../utils/HelperFunctions'

class ContactProperties extends Component {
    constructor(props) {
        super(props)

        const storeState = store.getState()

        this.state = {
            showInfoModal: false,
            showPictureModal: false,
            showEmailModal: false,
            showPhoneModal: false,
            showLinkedInModal: false,
            isEnriching: false,
            showAddTaskModal: false,
            loggedUser: storeState.loggedUser,
            selectedTab: storeState.selectedNavItem,
            projectContacts: storeState.projectContacts,
            smallScreen: storeState.smallScreen,
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    componentDidMount() {
        this.writeBrowserURL()
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            loggedUser: storeState.loggedUser,
            selectedTab: storeState.selectedNavItem,
            projectContacts: storeState.projectContacts,
            smallScreen: storeState.smallScreen,
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    showModal = modal => {
        this.setState({ [modal]: true })
    }

    hideModal = modal => {
        this.setState({ [modal]: false })
    }

    changePropertyValue = (property, value) => {
        const { projectContacts } = this.state
        const { projectIndex, user, projectId } = this.props

        const contact = projectContacts[projectId].find(contact => contact.uid === user.uid)

        switch (property) {
            case 'info':
                ProjectHelper.setContactInfoInProject(
                    projectIndex,
                    contact,
                    contact.uid,
                    value.company.trim(),
                    contact.company,
                    value.role.trim(),
                    contact.role,
                    value.description.trim(),
                    contact.description
                )
                break
            case 'picture':
                setProjectContactPicture(projectId, user, user.uid, value)
                break
            case 'email':
                setProjectContactEmail(projectId, contact, user.uid, value.trim(), contact.email)
                break
            case 'phone':
                setProjectContactPhone(projectId, contact, user.uid, value.trim(), contact.phone)
                break
            case 'linkedInUrl':
                setProjectContactLinkedInUrl(projectId, contact, user.uid, value.trim())
                break
        }
    }

    deleteContact = () => {
        const { user, projectId } = this.props

        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_PROJECT_CONTACT,
                object: {
                    projectId: projectId,
                    contactId: user.uid,
                    contact: user,
                    navigation: DV_TAB_ROOT_CONTACTS,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to delete this contact?',
                },
            })
        )
    }

    validateEmail = email => {
        return email === '' || HelperFunctions.isValidEmail(email)
    }

    enrichContact = async () => {
        const { projectContacts, loggedUser } = this.state
        const { projectId, user: userProp } = this.props
        const contact = projectContacts[projectId].find(c => c.uid === userProp.uid)

        if (!contact?.linkedInUrl) return

        if (loggedUser.gold < 30) {
            alert(translate('Not enough Gold'))
            return
        }

        this.setState({ isEnriching: true })
        try {
            const result = await enrichContactViaLinkedIn(projectId, contact, contact.uid)
            if (result && result.error === 'insufficient_gold') {
                alert(translate('Not enough Gold'))
            }
        } catch (error) {
            console.error('LinkedIn enrichment failed:', error)
        }
        this.setState({ isEnriching: false })
    }

    writeBrowserURL = () => {
        if (this.state.selectedTab === DV_TAB_CONTACT_PROPERTIES) {
            const { user, projectId } = this.props
            const data = { projectId: projectId, userId: user.uid }
            URLsContacts.push(URL_CONTACT_DETAILS_PROPERTIES, data, projectId, user.uid)
        }
    }

    render() {
        const {
            projectContacts,
            smallScreen: mobile,
            smallScreenNavigation: mobileNav,
            showInfoModal,
            showPictureModal,
            showEmailModal,
            showPhoneModal,
            showLinkedInModal,
            isEnriching,
            showAddTaskModal,
            loggedUser,
        } = this.state
        const { projectIndex, user: userProp, projectId } = this.props

        const user = projectContacts[projectId]?.find(contact => contact.uid === userProp.uid)
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

        if (user !== undefined) {
            const userRole = ProjectHelper.getUserRoleInProject(projectId, user.uid, user.role)
            const userCompany = ProjectHelper.getUserCompanyInProject(projectId, user.uid, user.company)
            const userDescription = ProjectHelper.getUserDescriptionInProject(
                projectId,
                user.uid,
                user.description,
                user.extendedDescription,
                false
            )
            const highlightColor = ProjectHelper.getUserHighlightInProject(projectIndex, user)
            const userPhoto50 = ContactsHelper.getContactPhotoURL(user, false, PHOTO_SIZE_50)
            const userPhoto300 = ContactsHelper.getContactPhotoURL(user, false, PHOTO_SIZE_300)
            user.hasStar = highlightColor

            const userInfo =
                !userRole && !userCompany
                    ? userDescription
                        ? userDescription
                        : ''
                    : `${userRole ? userRole : ''}${userRole && userCompany ? ' • ' : ''}${
                          userCompany ? userCompany : ''
                      }`

            const loggedUserIsCreator = loggedUser.uid === userProp.recorderUserId
            const loggedUserCanUpdateObject =
                loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

            return (
                <View style={localStyles.container}>
                    <UserPropertiesHeader />

                    <View style={[localStyles.properties, mobile ? localStyles.propertiesMobile : undefined]}>
                        <View style={{ flex: 1, marginRight: mobile ? 0 : 72 }}>
                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'info'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />
                                    {mobileNav ? (
                                        <Text style={[styles.body1]} numberOfLines={1}>
                                            {userInfo}
                                        </Text>
                                    ) : (
                                        <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                                            {translate('Info')}
                                        </Text>
                                    )}
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    {!mobileNav && (
                                        <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                                            {userInfo}
                                        </Text>
                                    )}

                                    <Popover
                                        content={
                                            <ChangeContactInfoModal
                                                projectId={projectId}
                                                closePopover={() => this.hideModal('showInfoModal')}
                                                onSaveData={value => this.changePropertyValue('info', value)}
                                                currentRole={userRole ? userRole : ''}
                                                currentCompany={userCompany ? userCompany : ''}
                                                currentDescription={userDescription ? userDescription : ''}
                                                disabled={!loggedUserCanUpdateObject}
                                            />
                                        }
                                        onClickOutside={() => this.hideModal('showInfoModal')}
                                        isOpen={showInfoModal}
                                        position={['bottom', 'left', 'right', 'top']}
                                        padding={4}
                                        align={'end'}
                                        contentLocation={mobile ? null : undefined}
                                    >
                                        <Button
                                            icon={'edit'}
                                            type={'ghost'}
                                            onPress={() => this.showModal('showInfoModal')}
                                            disabled={!accessGranted}
                                        />
                                    </Popover>
                                </View>
                            </View>

                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'link'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />
                                    {mobileNav ? (
                                        user.linkedInUrl !== '' ? (
                                            <TouchableOpacity
                                                onPress={() => {
                                                    if (window) {
                                                        window.open(user.linkedInUrl, '_blank')
                                                    } else {
                                                        Linking.openURL(user.linkedInUrl)
                                                    }
                                                }}
                                            >
                                                <Text
                                                    style={[styles.body1, { color: colors.Primary100 }]}
                                                    numberOfLines={1}
                                                >
                                                    {user.linkedInUrl}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : (
                                            <Text style={[styles.body1]} numberOfLines={1}>
                                                {translate('LinkedIn URL')}
                                            </Text>
                                        )
                                    ) : (
                                        <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                                            {translate('LinkedIn URL')}
                                        </Text>
                                    )}
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    {!mobileNav &&
                                        (user.linkedInUrl !== '' ? (
                                            <TouchableOpacity
                                                onPress={() => {
                                                    if (window) {
                                                        window.open(user.linkedInUrl, '_blank')
                                                    } else {
                                                        Linking.openURL(user.linkedInUrl)
                                                    }
                                                }}
                                            >
                                                <Text
                                                    style={[styles.body1, { marginRight: 8, color: colors.Primary100 }]}
                                                    numberOfLines={1}
                                                >
                                                    {user.linkedInUrl}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : (
                                            <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                                                {translate('No LinkedIn URL')}
                                            </Text>
                                        ))}

                                    <Popover
                                        content={
                                            <ChangeTextFieldModal
                                                header={translate('Edit LinkedIn URL')}
                                                subheader={translate('Type the LinkedIn profile URL')}
                                                label={translate('LinkedIn URL')}
                                                placeholder={'https://www.linkedin.com/in/...'}
                                                closePopover={() => this.hideModal('showLinkedInModal')}
                                                onSaveData={value => this.changePropertyValue('linkedInUrl', value)}
                                                currentValue={user.linkedInUrl}
                                            />
                                        }
                                        onClickOutside={() => this.hideModal('showLinkedInModal')}
                                        isOpen={showLinkedInModal}
                                        position={['bottom', 'left', 'right', 'top']}
                                        padding={4}
                                        align={'end'}
                                        contentLocation={mobile ? null : undefined}
                                    >
                                        <Button
                                            icon={'edit'}
                                            type={'ghost'}
                                            onPress={() => this.showModal('showLinkedInModal')}
                                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                                        />
                                    </Popover>

                                    {user.linkedInUrl !== '' && accessGranted && loggedUserCanUpdateObject && (
                                        <Button
                                            title={
                                                isEnriching
                                                    ? translate('Loading')
                                                    : `${translate('Enrich via LinkedIn')} (30 Gold)`
                                            }
                                            type={'ghost'}
                                            onPress={this.enrichContact}
                                            disabled={isEnriching}
                                        />
                                    )}
                                </View>
                            </View>

                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'lock'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />
                                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                        {translate('Privacy')}
                                    </Text>
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    <PrivacyButton
                                        projectId={projectId}
                                        object={user}
                                        objectType={FEED_CONTACT_OBJECT_TYPE}
                                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                                        shortcutText={'P'}
                                    />
                                </View>
                            </View>

                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'phone'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />

                                    {mobileNav ? (
                                        <Text style={[styles.body1]} numberOfLines={1}>
                                            {user.phone === '' ? translate('Phone unknown') : user.phone}
                                        </Text>
                                    ) : (
                                        <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                                            {translate('Phone')}
                                        </Text>
                                    )}
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    {!mobileNav && (
                                        <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                                            {user.phone === '' ? translate('Phone unknown') : user.phone}
                                        </Text>
                                    )}

                                    <Popover
                                        content={
                                            <ChangeTextFieldModal
                                                header={'Edit phone'}
                                                subheader={'Type the phone of this person'}
                                                label={'Phone'}
                                                placeholder={'Type the phone number'}
                                                closePopover={() => this.hideModal('showPhoneModal')}
                                                onSaveData={value => this.changePropertyValue('phone', value)}
                                                currentValue={user.phone}
                                            />
                                        }
                                        onClickOutside={() => this.hideModal('showPhoneModal')}
                                        isOpen={showPhoneModal}
                                        position={['bottom', 'left', 'right', 'top']}
                                        padding={4}
                                        align={'end'}
                                        contentLocation={mobile ? null : undefined}
                                    >
                                        <Button
                                            icon={'edit'}
                                            type={'ghost'}
                                            onPress={() => this.showModal('showPhoneModal')}
                                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                                        />
                                    </Popover>
                                </View>
                            </View>
                            {accessGranted && (
                                <FollowObject
                                    projectId={projectId}
                                    followObjectsType={FOLLOWER_CONTACTS_TYPE}
                                    followObjectId={user.uid}
                                    loggedUserId={loggedUser.uid}
                                    object={user}
                                />
                            )}
                        </View>

                        <View style={{ flex: 1 }}>
                            <AssistantProperty
                                projectId={projectId}
                                assistantId={user.assistantId}
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                                objectId={user.uid}
                                objectType={'contacts'}
                            />
                            <ContactStatusProperty
                                projectId={projectId}
                                contactStatusId={user.contactStatusId}
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                                contact={user}
                            />
                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'highlight'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />
                                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                        {translate('Highlight')}
                                    </Text>
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    <HighlightButton
                                        projectId={projectId}
                                        object={user}
                                        objectType={FEED_CONTACT_OBJECT_TYPE}
                                        shortcutText={'H'}
                                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                                    />
                                </View>
                            </View>

                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'image'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />
                                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                        {translate('Picture')}
                                    </Text>
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    <Popover
                                        content={
                                            <ImagePickerModal
                                                closePopover={() => this.hideModal('showPictureModal')}
                                                onSavePicture={value => this.changePropertyValue('picture', value)}
                                                picture={userPhoto300 !== '' ? userPhoto300 : undefined}
                                            />
                                        }
                                        onClickOutside={() => this.hideModal('showPictureModal')}
                                        isOpen={showPictureModal}
                                        position={['bottom', 'left', 'right', 'top']}
                                        padding={4}
                                        align={'end'}
                                        contentLocation={mobile ? null : undefined}
                                    >
                                        <Button
                                            icon={userPhoto50 === '' ? 'image' : <Picture photoURL={userPhoto50} />}
                                            type={'ghost'}
                                            onPress={() => this.showModal('showPictureModal')}
                                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                                        />
                                    </Popover>
                                </View>
                            </View>

                            <View style={localStyles.propertyRow}>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                                    <Icon
                                        name={'mail'}
                                        size={24}
                                        color={colors.Text03}
                                        style={{ marginHorizontal: 8 }}
                                    />
                                    {mobileNav ? (
                                        <Text style={[styles.body1]} numberOfLines={1}>
                                            {user.email === '' ? 'Email unknown' : user.email}
                                        </Text>
                                    ) : (
                                        <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                                            {translate('Email')}
                                        </Text>
                                    )}
                                </View>
                                <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                                    {!mobileNav && (
                                        <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                                            {user.email === '' ? translate('Email unknown') : user.email}
                                        </Text>
                                    )}

                                    <Popover
                                        content={
                                            <ChangeTextFieldModal
                                                header={'Edit email'}
                                                subheader={'Type the email of this person'}
                                                label={'Email'}
                                                placeholder={'Type the email address'}
                                                closePopover={() => this.hideModal('showEmailModal')}
                                                onSaveData={value => this.changePropertyValue('email', value)}
                                                currentValue={user.email}
                                                validateFunction={this.validateEmail}
                                            />
                                        }
                                        onClickOutside={() => this.hideModal('showEmailModal')}
                                        isOpen={showEmailModal}
                                        position={['bottom', 'left', 'right', 'top']}
                                        padding={4}
                                        align={'end'}
                                        contentLocation={mobile ? null : undefined}
                                    >
                                        <Button
                                            icon={'edit'}
                                            type={'ghost'}
                                            onPress={() => this.showModal('showEmailModal')}
                                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                                        />
                                    </Popover>
                                </View>
                            </View>

                            {accessGranted && loggedUserCanUpdateObject && (
                                <View style={localStyles.bottomContainer}>
                                    <View style={localStyles.addTaskButton}>
                                        <Popover
                                            content={
                                                <RichCreateTaskModal
                                                    initialProjectId={projectId}
                                                    sourceType={FEED_CONTACT_OBJECT_TYPE}
                                                    sourceId={user.uid}
                                                    closeModal={() => this.setState({ showAddTaskModal: false })}
                                                />
                                            }
                                            onClickOutside={() => this.setState({ showAddTaskModal: false })}
                                            isOpen={showAddTaskModal}
                                            padding={4}
                                            position={['top', 'bottom', 'left', 'right']}
                                            align={'end'}
                                            contentLocation={args => popoverToSafePosition(args, mobileNav)}
                                        >
                                            <Button
                                                icon={'check-square'}
                                                title={translate('Add task with this contact')}
                                                type={'ghost'}
                                                onPress={() => this.setState({ showAddTaskModal: true })}
                                                accessible={false}
                                            />
                                        </Popover>
                                    </View>
                                    <ObjectRevisionHistory projectId={projectId} noteId={user.noteId} />
                                    <View style={localStyles.deleteButton}>
                                        <Button
                                            icon={'trash-2'}
                                            title={translate('Delete')}
                                            type={'ghost'}
                                            iconColor={colors.UtilityRed200}
                                            titleStyle={{ color: colors.UtilityRed200 }}
                                            buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
                                            onPress={this.deleteContact}
                                            accessible={false}
                                        />
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            )
        }

        return null
    }
}

ContactProperties.propTypes = {
    projectIndex: PropTypes.number.isRequired,
    user: PropTypes.object.isRequired,
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    properties: {
        flexDirection: 'row',
    },
    propertiesMobile: {
        flexDirection: 'column',
    },
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    propertyRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    propertyRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    propertyRowRight: {
        justifyContent: 'flex-end',
    },
    bottomContainer: {
        marginTop: 32,
    },
    addTaskButton: {
        flexDirection: 'row',
        paddingVertical: 8,
        justifyContent: 'flex-end',
    },
    deleteButton: {
        flexDirection: 'row',
        paddingVertical: 8,
        justifyContent: 'flex-end',
    },
})

export default ContactProperties
