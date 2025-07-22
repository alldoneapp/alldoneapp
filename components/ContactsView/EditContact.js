import React, { Component } from 'react'
import { Image, Keyboard, StyleSheet, Text, View } from 'react-native'
import Button from '../UIControls/Button'
import Icon from '../Icon'
import store from '../../redux/store'
import styles, { colors } from '../styles/global'
import { cloneDeep, isEqual } from 'lodash'
import Backend from '../../utils/BackendBridge'
import Popover from 'react-tiny-popover'
import ImagePickerModal from '../UIComponents/FloatModals/ImagePickerModal'
import {
    hideFloatPopup,
    setLastAddNewContact,
    setNavigationRoute,
    setSelectedNavItem,
    setTmpInputTextContact,
    showFloatPopup,
    startLoadingData,
    stopLoadingData,
} from '../../redux/actions'
import ContactsHelper, { PHOTO_SIZE_300, PHOTO_SIZE_50 } from './Utils/ContactsHelper'
import HelperFunctions, { execShortcutFn } from '../../utils/HelperFunctions'
import NavigationService from '../../utils/NavigationService'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import Hotkeys from 'react-hot-keys'
import ChangeContactInfoModal from '../UIComponents/FloatModals/ChangeContactInfoModal'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import {
    DV_TAB_CONTACT_PROPERTIES,
    DV_TAB_PROJECT_TEAM_MEMBERS,
    DV_TAB_USER_PROFILE,
} from '../../utils/TabNavigationConstants'
import Spinner from '../UIComponents/Spinner'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import CommentsWrapper from '../Feeds/InteractionBar/CommentsWrapper'
import { FEED_CONTACT_OBJECT_TYPE, FEED_USER_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import PrivacyButton from '../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import HighlightButton from '../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import ContactMoreButton from '../UIComponents/FloatModals/MorePopupsOfEditModals/Contacts/ContactMoreButton'
import { FORM_TYPE_EDIT, FORM_TYPE_NEW } from '../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import { translate } from '../../i18n/TranslationService'
import {
    addContactToProject,
    setProjectContactHighlight,
    setProjectContactName,
    setProjectContactPicture,
} from '../../utils/backends/Contacts/contactsFirestore'
import { setUserHighlightInProject, setUserPrivacyInProject } from '../../utils/backends/Users/usersFirestore'

export default class EditContact extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()
        const contact = this.props.isNew ? ContactsHelper.getDefaultContactInfo() : this.props.contact
        const clonedContact = cloneDeep(contact)

        this.state = {
            loggedUserId: store.getState().loggedUser.uid,
            loggedUserProjects: storeState.loggedUserProjects,
            loading: false,
            contact: contact,
            tmpContact: clonedContact,
            isEmail: false,
            contactChanged: false,
            showInfoModal: false,
            showPictureModal: false,
            smallScreen: storeState.smallScreen,
            isMiddleScreen: storeState.isMiddleScreen,
            unsubscribe: store.subscribe(this.updateState),
        }
        this.inputTextRef = React.createRef()
    }

    componentDidMount() {
        store.dispatch(setLastAddNewContact({ projectId: this.props.projectId }))
        document.addEventListener('keydown', this.onPressKey)
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onPressKey)
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreen: storeState.smallScreen,
            isMiddleScreen: storeState.isMiddleScreen,
        })

        if (storeState.showGlobalSearchPopup) {
            this.dismiss()
        }
    }

    enterActionKey = e => {
        const { showFloatPopup } = store.getState()
        if (!showFloatPopup) {
            const { isNew } = this.props
            const { tmpContact } = this.state
            if (e) {
                e.preventDefault()
                e.stopPropagation()
            }
            if (isNew) {
                if (tmpContact.displayName.length > 0) {
                    this.addProjectContact()
                } else {
                    this.dismiss()
                }
            } else {
                this.onSubmit()
            }
        }
    }

    onPressKey = e => {
        if (e.key === 'Enter') {
            this.enterActionKey(e)
        }
    }

    updateContactField = async (field, value) => {
        const { tmpContact, contact } = this.state
        if (typeof value === 'string') {
            tmpContact[field] = value.trim().length <= 0 ? '' : value

            if (field === 'description') {
                tmpContact.extendedDescription = value
                tmpContact.description = TasksHelper.getTaskNameWithoutMeta(value)
            }
        } else if (field === 'isPrivate') {
            tmpContact.isPrivate = value.isPrivate
            tmpContact.isPublicFor = value.isPublicFor
        } else {
            tmpContact[field] = value
        }

        if (!isEqual(tmpContact, contact)) {
            this.setState({ tmpContact: tmpContact, contactChanged: true })
        } else {
            this.setState({ contactChanged: false })
        }
    }

    changeInfo = info => {
        this.updateContactField('role', info.role)
        this.updateContactField('company', info.company)
        this.updateContactField('description', info.description)
    }

    changePropertyValue = value => {
        const { projectIndex, contact, dismissibleRef, isMember, projectId } = this.props

        dismissibleRef?.toggleModal()

        if (isMember) {
            ProjectHelper.setUserInfoInProject(
                projectId,
                projectIndex,
                contact.uid,
                value.company.trim(),
                value.role.trim(),
                value.description.trim()
            )
        } else {
            ProjectHelper.setContactInfoInProject(
                projectIndex,
                contact,
                contact.uid,
                value.company.trim(),
                contact.company,
                value.role.trim(),
                contact.role,
                value.description.trim(),
                contact.extendedDescription
            )
        }
    }

    onChangeInputText = text => {
        const { isNew } = this.props
        this.updateContactField('displayName', text)
        this.setState({ isEmail: text !== '' && text.indexOf('@') >= 0 })
        if (isNew) store.dispatch(setTmpInputTextContact(text))
    }

    changePicture = async value => {
        const { projectId, contact, dismissibleRef, isNew } = this.props
        if (!isNew) {
            await setProjectContactPicture(projectId, contact, contact.uid, value)
            dismissibleRef?.toggleModal()
        } else {
            this.updateContactField('photoURL', value)
        }
    }

    setPrivacyBeforeSave = (isPrivate, isPublicFor) => {
        const { projectIndex, contact, dismissibleRef, isMember } = this.props
        const { loggedUserProjects } = store.getState()
        const project = loggedUserProjects[projectIndex]

        if (isMember) {
            setUserPrivacyInProject(project, contact, isPrivate, isPublicFor)
            dismissibleRef?.toggleModal()
        } else {
            const privacy = { isPrivate, isPublicFor }
            this.updateContactField('isPrivate', privacy)
        }
    }

    setHighlightBeforeSave = (highlightColor, directAction = false) => {
        const { projectIndex, contact, dismissibleRef, isMember } = this.props
        const { loggedUserProjects, loggedUser } = store.getState()
        const project = loggedUserProjects[projectIndex]

        if (directAction) {
            if (isMember) {
                setUserHighlightInProject(project, contact, highlightColor)
            } else {
                setProjectContactHighlight(project.id, contact, contact.uid, highlightColor)
            }
            dismissibleRef?.toggleModal()
        } else {
            this.updateContactField('hasStar', highlightColor)
        }
    }

    setPhoneBeforeSave = phone => {
        this.updateContactField('phone', phone)
    }

    setEmailBeforeSave = email => {
        this.updateContactField('email', email)
    }

    showInfoModal = () => {
        this.setState({ showInfoModal: true })
        store.dispatch(showFloatPopup())
    }

    hideInfoModal = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditContact
        const { showFloatPopup } = store.getState()
        if (showFloatPopup === 1) {
            setTimeout(async () => {
                this.setState({ showInfoModal: false })
                store.dispatch(hideFloatPopup())
                this.focusInput()
            })
        }
    }

    showPictureModal = () => {
        this.setState({ showPictureModal: true })
        store.dispatch(showFloatPopup())
    }

    hidePictureModal = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditContact
        setTimeout(async () => {
            this.setState({ showPictureModal: false })
            store.dispatch(hideFloatPopup())
            this.focusInput()
        }, 200)
    }

    focusInput = () => {
        if (this.inputTextRef && this.inputTextRef.current) {
            this.inputTextRef.current.focus()
        }
    }

    blurInput = () => {
        if (this.inputTextRef && this.inputTextRef.current) {
            this.inputTextRef.current.blur()
        }
    }
    onUserPress = () => {
        const { contact, isMember, projectIndex } = this.props
        const { loggedUserProjects } = this.state
        NavigationService.navigate(isMember ? 'UserDetailedView' : 'ContactDetailedView', {
            contact: contact,
            project: loggedUserProjects[projectIndex],
        })
        store.dispatch(setSelectedNavItem(isMember ? DV_TAB_USER_PROFILE : DV_TAB_CONTACT_PROPERTIES))
    }

    onSubmit = () => {
        const { tmpContact, contactChanged, loggedUserId } = this.state
        const { dismissibleRef, contact, projectId, isMember } = this.props

        const userIsLoggedUser = loggedUserId === contact.uid
        const loggedUserIsCreator = loggedUserId === contact.recorderUserId
        const loggedUserCanUpdateObject = isMember
            ? userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
            : loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

        if (contactChanged && loggedUserCanUpdateObject) {
            setProjectContactName(
                projectId,
                tmpContact,
                tmpContact.uid,
                tmpContact.displayName.trim(),
                contact.displayName
            )
        }
        dismissibleRef?.toggleModal()
    }

    render() {
        const {
            smallScreen,
            isMiddleScreen: mobile,
            isEmail,
            tmpContact,
            contactChanged,
            showInfoModal,
            showPictureModal,
            loading,
            loggedUserId,
        } = this.state
        const { onCancelAction, style, projectId, isNew, projectIndex, isMember, dismissibleRef, contact } = this.props
        const buttonItemStyle = { marginHorizontal: smallScreen ? 4 : 2 }
        const userRole = ProjectHelper.getUserRoleInProject(projectId, tmpContact.uid, tmpContact.role)
        const userCompany = ProjectHelper.getUserCompanyInProject(projectId, tmpContact.uid, tmpContact.company)
        const userDescription = ProjectHelper.getUserDescriptionInProject(
            projectId,
            tmpContact.uid,
            tmpContact.description,
            tmpContact.extendedDescription,
            true
        )
        const highlightColor = ProjectHelper.getUserHighlightInProject(projectIndex, tmpContact)
        const contactPhoto50 = ContactsHelper.getContactPhotoURL(tmpContact, isMember, PHOTO_SIZE_50)
        const contactPhoto300 = ContactsHelper.getContactPhotoURL(tmpContact, isMember, PHOTO_SIZE_300)
        tmpContact.hasStar = highlightColor

        const userIsLoggedUser = isNew || loggedUserId === contact.uid
        const loggedUserIsCreator = isNew || loggedUserId === contact.recorderUserId
        const loggedUserCanUpdateObject = isMember
            ? userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
            : loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

        return (
            <View
                style={[localStyles.container, mobile ? localStyles.containerUnderBreakpoint : undefined, style]}
                data-edit-contact={`${isNew ? 'new-contact' : contact.uid}`}
            >
                <View style={[localStyles.inputContainer]}>
                    <View
                        style={[
                            localStyles.icon,
                            !isNew && { top: 7, left: 15 },
                            mobile && (!isNew ? { left: 8 } : localStyles.iconMobile),
                        ]}
                    >
                        {isNew ? (
                            <Icon name={'plus-square'} size={24} color={colors.Primary100} />
                        ) : (
                            <View style={localStyles.userPhoto}>
                                {tmpContact.photoURL != null && tmpContact.photoURL !== '' ? (
                                    <View>
                                        <Image
                                            onLoadStart={() => this.setState({ loading: true })}
                                            onLoadEnd={() => this.setState({ loading: false })}
                                            source={{ uri: contactPhoto50 }}
                                            style={[localStyles.image, { display: loading ? 'none' : 'flex' }]}
                                        />

                                        {loading && (
                                            <View style={{ backgroundColor: colors.Gray200 }}>
                                                <Spinner containerSize={48} spinnerSize={24} />
                                            </View>
                                        )}
                                    </View>
                                ) : (
                                    <SVGGenericUser
                                        width={48}
                                        height={48}
                                        svgid={`ci_p_${tmpContact.uid}_${projectIndex}`}
                                    />
                                )}
                            </View>
                        )}
                    </View>

                    {isMember ? (
                        <Text
                            style={[
                                localStyles.input,
                                mobile ? localStyles.inputUnderBreakpoint : undefined,
                                { height: 62, paddingTop: 19 },
                            ]}
                        >
                            {tmpContact.displayName}
                        </Text>
                    ) : (
                        <CustomTextInput3
                            fixedHeight={62}
                            ref={this.inputTextRef}
                            initialTextExtended={isNew ? store.getState().tmpInputTextContact : tmpContact.displayName}
                            returnKeyType={'done'}
                            placeholder={translate('Type email or name to add person')}
                            containerStyle={[localStyles.input, mobile ? localStyles.inputUnderBreakpoint : undefined]}
                            autoFocus={true}
                            multiline={false}
                            numberOfLines={1}
                            onChangeText={this.onChangeInputText}
                            placeholderTextColor={colors.Text03}
                            projectId={projectId}
                            forceTriggerEnterActionForBreakLines={this.enterActionKey}
                            disabledEdition={!loggedUserCanUpdateObject}
                        />
                    )}
                </View>
                <View style={localStyles.buttonContainer}>
                    <View style={[localStyles.buttonSection]}>
                        <View style={smallScreen ? undefined : { marginRight: 32 }}>
                            <Hotkeys
                                keyName={'alt+O'}
                                disabled={!contactChanged || isEmail}
                                onKeyDown={(sht, event) =>
                                    execShortcutFn(
                                        this.openBtnRef,
                                        isNew ? this.openBeforeCreate : this.onUserPress,
                                        event
                                    )
                                }
                                filter={e => true}
                            >
                                <Button
                                    ref={ref => (this.openBtnRef = ref)}
                                    title={smallScreen ? null : translate('Open nav')}
                                    type={'secondary'}
                                    noBorder={smallScreen}
                                    icon={'maximize-2'}
                                    iconColor={'#8A94A6'}
                                    buttonStyle={buttonItemStyle}
                                    onPress={isNew ? this.openBeforeCreate : this.onUserPress}
                                    disabled={(isNew && !contactChanged) || isEmail}
                                    shortcutText={'O'}
                                />
                            </Hotkeys>
                        </View>

                        {loggedUserCanUpdateObject && (
                            <Popover
                                content={
                                    <ChangeContactInfoModal
                                        projectId={projectId}
                                        closePopover={this.hideInfoModal}
                                        onSaveData={value =>
                                            !isNew ? this.changePropertyValue(value) : this.changeInfo(value)
                                        }
                                        currentRole={userRole ? userRole : ''}
                                        currentCompany={userCompany ? userCompany : ''}
                                        currentDescription={userDescription ? userDescription : ''}
                                    />
                                }
                                onClickOutside={this.hideInfoModal}
                                isOpen={showInfoModal}
                                position={['bottom', 'left', 'right', 'top']}
                                padding={4}
                                align={'end'}
                                contentLocation={mobile ? null : undefined}
                            >
                                <Hotkeys
                                    keyName={'alt+I'}
                                    onKeyDown={(sht, event) =>
                                        execShortcutFn(this.infoBtnRef, this.showInfoModal, event)
                                    }
                                    filter={e => true}
                                >
                                    <Button
                                        ref={ref => (this.infoBtnRef = ref)}
                                        title={smallScreen ? null : translate('Info')}
                                        type={'ghost'}
                                        noBorder={smallScreen}
                                        icon={'info'}
                                        buttonStyle={buttonItemStyle}
                                        onPress={this.showInfoModal}
                                        disabled={(isNew && !contactChanged) || isEmail}
                                        shortcutText={'I'}
                                    />
                                </Hotkeys>
                            </Popover>
                        )}

                        {!isMember && loggedUserCanUpdateObject && (
                            <Popover
                                content={
                                    <ImagePickerModal
                                        closePopover={this.hidePictureModal}
                                        onSavePicture={this.changePicture}
                                        picture={contactPhoto300 !== '' ? contactPhoto300 : undefined}
                                        onOpenModal={this.blurInput}
                                    />
                                }
                                onClickOutside={this.hidePictureModal}
                                isOpen={showPictureModal}
                                position={['bottom', 'left', 'right', 'top']}
                                padding={4}
                                align={'end'}
                                contentLocation={mobile ? null : undefined}
                            >
                                <Hotkeys
                                    keyName={'alt+1'}
                                    disabled={!contactChanged || isEmail}
                                    onKeyDown={(sht, event) =>
                                        execShortcutFn(this.pictureBtnRef, this.showPictureModal, event)
                                    }
                                    filter={e => true}
                                >
                                    <Button
                                        ref={ref => (this.pictureBtnRef = ref)}
                                        title={smallScreen ? null : translate('Picture')}
                                        type={'ghost'}
                                        noBorder={smallScreen}
                                        icon={contactPhoto50 === '' ? 'image' : <Picture photoURL={contactPhoto50} />}
                                        buttonStyle={buttonItemStyle}
                                        onPress={this.showPictureModal}
                                        disabled={(isNew && !contactChanged) || isEmail}
                                        shortcutText={'1'}
                                    />
                                </Hotkeys>
                            </Popover>
                        )}

                        {(isMember || isNew) && loggedUserCanUpdateObject && (
                            <PrivacyButton
                                projectId={projectId}
                                object={tmpContact}
                                objectType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
                                disabled={(isNew && !contactChanged) || isEmail}
                                savePrivacyBeforeSaveObject={isNew && this.setPrivacyBeforeSave}
                                inEditComponent={true}
                                style={buttonItemStyle}
                                shortcutText={'P'}
                            />
                        )}

                        {!isNew && (
                            <CommentsWrapper
                                style={buttonItemStyle}
                                projectId={projectId}
                                commentedFeed={isMember ? { userId: tmpContact.uid } : { contactId: tmpContact.uid }}
                                smallScreen={smallScreen}
                                extraFunction={dismissibleRef?.toggleModal}
                                userGettingKarmaId={contact.recorderUserId ? contact.recorderUserId : contact.uid}
                                assistantId={tmpContact.assistantId}
                            />
                        )}

                        {loggedUserCanUpdateObject && (
                            <HighlightButton
                                projectId={projectId}
                                object={tmpContact}
                                objectType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
                                disabled={(isNew && !contactChanged) || isEmail}
                                saveHighlightBeforeSaveObject={color => this.setHighlightBeforeSave(color, !isNew)}
                                inEditComponent={true}
                                style={buttonItemStyle}
                                shortcutText={'H'}
                            />
                        )}

                        {loggedUserCanUpdateObject && (
                            <ContactMoreButton
                                formType={isNew ? FORM_TYPE_NEW : FORM_TYPE_EDIT}
                                projectId={projectId}
                                contact={tmpContact}
                                isMember={isMember}
                                buttonStyle={buttonItemStyle}
                                disabled={(isNew && !contactChanged) || isEmail}
                                savePhoneBeforeSaveContact={isNew && this.setPhoneBeforeSave}
                                saveEmailBeforeSaveContact={isNew && this.setEmailBeforeSave}
                                dismissEditMode={this.dismiss}
                            />
                        )}
                    </View>

                    <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                        {smallScreen ? undefined : (
                            <Button
                                title={translate('Cancel')}
                                type={'secondary'}
                                buttonStyle={{ marginHorizontal: 4 }}
                                onPress={onCancelAction}
                                shortcutText={'Esc'}
                            />
                        )}

                        <Button
                            title={
                                smallScreen
                                    ? null
                                    : contactChanged
                                    ? translate(isEmail ? 'Invite' : isNew ? 'Add Person' : 'Save')
                                    : 'Ok'
                            }
                            type={'primary'}
                            icon={smallScreen ? (contactChanged ? (isNew ? 'plus' : 'save') : 'x') : null}
                            onPress={() => (isNew ? this.addProjectContact() : this.onSubmit())}
                            shortcutText={'Enter'}
                        />
                    </View>
                </View>
            </View>
        )
    }

    addProjectContact = async (openDetails = false) => {
        const { projectId } = this.props
        const { tmpContact, contactChanged } = this.state
        tmpContact.displayName = tmpContact.displayName.trim()

        if (contactChanged) {
            if (tmpContact.displayName.length > 0) {
                store.dispatch(setTmpInputTextContact(''))

                // If contact name is an email, then send an invitation
                if (HelperFunctions.isValidEmail(tmpContact.displayName)) {
                    Backend.inviteUserToProject(tmpContact.displayName, projectId, tmpContact.recorderUserId)
                    store.dispatch([setSelectedNavItem(DV_TAB_PROJECT_TEAM_MEMBERS)])
                    NavigationService.navigate('ProjectDetailedView', {
                        projectIndex: ProjectHelper.getProjectIndexById(projectId),
                    })
                } else {
                    store.dispatch(startLoadingData())

                    if (tmpContact.photoURL !== '' && tmpContact.photoURL != null) {
                        const src =
                            typeof tmpContact.photoURL === 'string'
                                ? tmpContact.photoURL
                                : URL.createObjectURL(tmpContact.photoURL)

                        const resized50 = (await HelperFunctions.resizeImage(src, PHOTO_SIZE_50)).uri
                        const resized300 = (await HelperFunctions.resizeImage(src, PHOTO_SIZE_300)).uri

                        tmpContact.photoURL = await HelperFunctions.convertURItoBlob(tmpContact.photoURL)
                        tmpContact.photoURL50 = await HelperFunctions.convertURItoBlob(resized50)
                        tmpContact.photoURL300 = await HelperFunctions.convertURItoBlob(resized300)
                    }
                    addContactToProject(projectId, tmpContact, contact => {
                        store.dispatch(stopLoadingData())

                        if (openDetails) {
                            NavigationService.navigate('ContactDetailedView', {
                                contact: contact,
                                project: { id: projectId, index: ProjectHelper.getProjectIndexById(projectId) },
                            })
                            store.dispatch(setSelectedNavItem(DV_TAB_CONTACT_PROPERTIES))
                        }
                    })
                }
            }
            this.dismiss()
        } else {
            this.dismiss()
        }
    }

    openBeforeCreate = () => {
        this.addProjectContact(true)
    }

    dismiss = () => {
        const { onCancelAction } = this.props
        onCancelAction()
        Keyboard.dismiss()
    }
}

export class Picture extends React.Component {
    shouldComponentUpdate(nextProps, nextState, nextContext) {
        return !isEqual(this.props, nextProps)
    }

    render() {
        const { photoURL } = this.props
        const src = typeof photoURL === 'string' ? photoURL : photoURL?.length > 0 ? URL.createObjectURL(photoURL) : ''

        return (
            <View style={localStyles.picture}>
                <Image style={{ width: 24, height: 24 }} source={src} />
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 8,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        //height: 56,
        overflow: 'hidden',
        //flexDirection: 'row',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 27,
        top: 15,
    },
    iconMobile: {
        left: 19,
    },
    picture: {
        width: 24,
        height: 24,
        borderRadius: 100,
        overflow: 'hidden',
    },
    input: {
        ...styles.body1,
        paddingTop: 14,
        paddingBottom: 12,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        marginLeft: 52,
        paddingLeft: 20,
        paddingRight: 16,
        textAlignVertical: 'top',
    },
    inputUnderBreakpoint: {
        paddingLeft: 12,
        paddingRight: 8,
    },
    userPhoto: {
        width: 48,
        height: 48,
        borderRadius: 100,
        overflow: 'hidden',
    },
    image: {
        width: 48,
        height: 48,
        borderRadius: 100,
    },
})
