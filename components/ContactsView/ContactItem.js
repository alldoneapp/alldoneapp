import React, { Component } from 'react'
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import store from '../../redux/store'
import MemberTag from '../Tags/MemberTag'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import Spinner from '../UIComponents/Spinner'
import ContactsHelper, { PHOTO_SIZE_50 } from './Utils/ContactsHelper'
import Backend from '../../utils/BackendBridge'
import BacklinksTag from '../Tags/BacklinksTag'
import ContactCommentsWrapper from '../Tags/ContactCommentsWrapper'
import moment from 'moment'
import PrivacyTag from '../Tags/PrivacyTag'
import { FEED_CONTACT_OBJECT_TYPE, FEED_USER_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import SocialText from '../UIControls/SocialText/SocialText'
import Icon from '../Icon'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import NavigationService from '../../utils/NavigationService'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import SwipeNewTaskWrapper from '../NotesView/SwipeNewTaskWrapper'
import { LINKED_OBJECT_TYPE_CONTACT } from '../../utils/LinkingHelper'
import ObjectNoteTag from '../Tags/ObjectNoteTag'
import ContactStatusTag from '../Tags/ContactStatusTag'
import { translate } from '../../i18n/TranslationService'
import { setSelectedNavItem } from '../../redux/actions'
import { DV_TAB_CONTACT_PROPERTIES, DV_TAB_USER_PROFILE } from '../../utils/TabNavigationConstants'

export default class ContactItem extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            loading: false,
            loggedUserProjects: storeState.loggedUserProjects,
            smallScreenNavigation: storeState.smallScreenNavigation,
            loggedUserId: storeState.loggedUser.uid,
            backlinksTasksCount: 0,
            backlinkTaskObject: null,
            backlinksNotesCount: 0,
            backlinkNoteObject: null,
            blockOpen: false,
            showNewTaskPopup: false,
            panColor: new Animated.Value(0),
            unsubscribe: store.subscribe(this.updateState),
        }

        this.itemSwipe = React.createRef()
    }

    componentDidMount() {
        const { loggedUserProjects } = this.state
        const { projectIndex, contact } = this.props
        const projectId = loggedUserProjects[projectIndex].id

        Backend.watchBacklinksCount(
            projectId,
            {
                type: LINKED_OBJECT_TYPE_CONTACT,
                idsField: 'linkedParentContactsIds',
                id: contact.uid,
            },
            (parentObjectType, parentsAmount, aloneParentObject) => {
                if (parentObjectType === 'tasks') {
                    this.setState({ backlinksTasksCount: parentsAmount, backlinkTaskObject: aloneParentObject })
                } else if (parentObjectType === 'notes') {
                    this.setState({ backlinksNotesCount: parentsAmount, backlinkNoteObject: aloneParentObject })
                }
            }
        )
    }

    componentWillUnmount() {
        const { contact } = this.props
        Backend.unwatchBacklinksCount(contact.uid)
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            loggedUserProjects: storeState.loggedUserProjects,
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    renderLeftSwipe = (progress, dragX) => {
        if (this.state.panColor !== dragX) {
            this.setState({ panColor: dragX })
        }

        return <View style={{ width: 150 }} />
    }

    onLeftSwipe = () => {
        const { projectIndex, contact, isMember } = this.props
        const { loggedUserProjects } = this.state
        this.itemSwipe.current.close()

        NavigationService.navigate(isMember ? 'UserDetailedView' : 'ContactDetailedView', {
            contact: contact,
            project: loggedUserProjects[projectIndex],
        })
        store.dispatch(setSelectedNavItem(isMember ? DV_TAB_USER_PROFILE : DV_TAB_CONTACT_PROPERTIES))
    }

    renderRightSwipe = (progress, dragX) => {
        if (this.state.panColor !== dragX) {
            this.setState({ panColor: dragX })
        }

        return <View style={{ width: 150 }} />
    }

    onRightSwipe = () => {
        this.itemSwipe.current.close()
        setTimeout(() => this.setState({ showNewTaskPopup: true }))
    }

    cancelPopover = () => {
        this.setState({ showNewTaskPopup: false })
    }

    onOpenDV = () => {
        const { loggedUserProjects } = this.state
        const { projectIndex, contact, isMember } = this.props
        const project = loggedUserProjects[projectIndex]
        NavigationService.navigate(isMember ? 'UserDetailedView' : 'ContactDetailedView', {
            contact: contact,
            project: project,
        })
        store.dispatch(setSelectedNavItem(isMember ? DV_TAB_USER_PROFILE : DV_TAB_CONTACT_PROPERTIES))
    }

    render() {
        const {
            loading,
            loggedUserProjects,
            blockOpen,
            panColor,
            showNewTaskPopup,
            backlinksTasksCount,
            backlinkTaskObject,
            backlinksNotesCount,
            backlinkNoteObject,
            loggedUserId,
        } = this.state
        const { projectIndex, contact, isMember, onPress } = this.props

        const projectId = loggedUserProjects[projectIndex].id
        const showContact = isMember || !ContactsHelper.isPrivateContact(contact)
        const contactHighlightColor = ProjectHelper.getUserHighlightInProject(projectIndex, contact)

        const outputColors = [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125]
        const backColor = panColor.interpolate({
            inputRange: [-100, 0, 100],
            outputRange: outputColors,
            extrapolate: 'clamp',
        })

        const backColorHighlight = panColor.interpolate({
            inputRange: [-100, 0, 100],
            outputRange: [colors.UtilityYellow125, contactHighlightColor, colors.UtilityGreen125],
            extrapolate: 'clamp',
        })

        const contactPhotoURL50 = ContactsHelper.getContactPhotoURL(contact, isMember, PHOTO_SIZE_50)
        const role = ProjectHelper.getUserRoleInProject(projectId, contact.uid, contact.role)
        const company = ProjectHelper.getUserCompanyInProject(projectId, contact.uid, contact.company)
        const description = ProjectHelper.getUserDescriptionInProject(
            projectId,
            contact.uid,
            contact.description,
            contact.extendedDescription,
            true
        )
        const highlightColor = contactHighlightColor.toLowerCase() !== '#ffffff' ? backColorHighlight : backColor

        if (isMember) {
            ContactsHelper.getAndAssignUserPrivacy(projectIndex, contact)
        }

        const parseDate = date => {
            if (Date.now() - date < 60000) {
                return translate('Just now')
            }
            return `${translate('Edited')}: ${moment(date).format(`${getTimeFormat(true)} of ${getDateFormat()}`)}`
        }

        const userInfo =
            !role && !company && !description
                ? ''
                : `${role ? role : ''}${role && (company || description) ? ' • ' : ''}${company ? company : ''}${
                      company && description ? ' • ' : ''
                  }${description ? description : ''}`

        const backlinksCount = backlinksTasksCount + backlinksNotesCount
        const backlinkObject =
            backlinksCount === 1 ? (backlinksTasksCount === 1 ? backlinkTaskObject : backlinkNoteObject) : null

        const userIsLoggedUser = loggedUserId === contact.uid
        const loggedUserIsCreator = loggedUserId === contact.recorderUserId
        const loggedUserCanUpdateObject = isMember
            ? userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
            : loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

        const commentsData = isMember ? contact.commentsData[projectId] : contact.commentsData

        return showContact ? (
            <View>
                <View style={localStyles.swipeContainer}>
                    <View style={localStyles.leftSwipeArea}>
                        <Icon name="circle-details" size={18} color={colors.UtilityGreen200} />
                        <View style={{ marginLeft: 4 }}>
                            <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>
                                {translate('Details')}
                            </Text>
                        </View>
                    </View>

                    <View style={localStyles.rightSwipeArea}>
                        <View style={localStyles.rightSwipeAreaContainer}>
                            <Icon name={'check-square'} size={18} color={colors.UtilityYellow200} />
                            <View style={{ marginLeft: 4 }}>
                                <Text style={[styles.subtitle2, { color: colors.UtilityYellow200 }]}>
                                    {translate('Add task')}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                <Swipeable
                    ref={this.itemSwipe}
                    rightThreshold={80}
                    leftThreshold={80}
                    enabled={true}
                    renderLeftActions={this.renderLeftSwipe}
                    onSwipeableLeftWillOpen={this.onLeftSwipe}
                    renderRightActions={this.renderRightSwipe}
                    onSwipeableRightWillOpen={this.onRightSwipe}
                    overshootLeft={false}
                    overshootRight={false}
                    friction={2}
                    containerStyle={{ overflow: 'visible' }}
                    failOffsetY={[-5, 5]}
                    onSwipeableWillClose={() => {
                        this.setState({ blockOpen: true })
                    }}
                    onSwipeableClose={() => {
                        this.setState({ blockOpen: false })
                    }}
                >
                    <TouchableOpacity
                        onPress={blockOpen ? undefined : this.onOpenDV}
                        disabled={blockOpen}
                        activeOpacity={blockOpen ? 1 : 0.5}
                    >
                        <Animated.View style={[localStyles.container, { backgroundColor: highlightColor }]}>
                            <View style={localStyles.avatarContainer}>
                                {contact.photoURL != null && contact.photoURL !== '' ? (
                                    <>
                                        <Image
                                            onLoadStart={() => this.setState({ loading: true })}
                                            onLoadEnd={() => this.setState({ loading: false })}
                                            source={{ uri: contactPhotoURL50 }}
                                            style={[localStyles.image, { display: loading ? 'none' : 'flex' }]}
                                        />

                                        {loading && <Spinner containerSize={48} spinnerSize={24} />}
                                    </>
                                ) : (
                                    <SVGGenericUser
                                        width={48}
                                        height={48}
                                        svgid={`ci_p_${contact.uid}_${projectIndex}`}
                                    />
                                )}
                            </View>

                            <View style={localStyles.userData}>
                                <SocialText
                                    showEllipsis
                                    style={localStyles.name}
                                    numberOfLines={1}
                                    bgColor={
                                        contactHighlightColor.toLowerCase() !== '#ffffff'
                                            ? backColorHighlight
                                            : backColor
                                    }
                                    projectId={projectId}
                                >
                                    {contact.displayName}
                                </SocialText>

                                {!!userInfo && (
                                    <SocialText
                                        showEllipsis
                                        style={localStyles.description}
                                        numberOfLines={1}
                                        bgColor={
                                            contactHighlightColor.toLowerCase() !== '#ffffff'
                                                ? backColorHighlight
                                                : backColor
                                        }
                                        projectId={projectId}
                                    >
                                        {userInfo}
                                    </SocialText>
                                )}

                                <Text style={[styles.caption2, localStyles.updatedInfo]} numberOfLines={1}>
                                    {parseDate(contact.lastEditionDate)}
                                </Text>
                            </View>

                            <View style={localStyles.buttonSection}>
                                {!isMember && contact.contactStatusId && (
                                    <ContactStatusTag
                                        projectId={projectId}
                                        contactStatusId={contact.contactStatusId}
                                        contact={contact}
                                    />
                                )}
                                {isMember && <MemberTag />}
                                {(contact.noteId ||
                                    (contact.noteIdsByProject && contact.noteIdsByProject[projectId])) && (
                                    <ObjectNoteTag
                                        objectId={contact.uid}
                                        objectType="contacts"
                                        projectId={projectId}
                                        style={{ marginLeft: 8 }}
                                    />
                                )}
                                {backlinksCount > 0 && (
                                    <BacklinksTag
                                        object={contact}
                                        objectType={LINKED_OBJECT_TYPE_CONTACT}
                                        projectId={projectId}
                                        style={{ marginLeft: 8 }}
                                        backlinksCount={backlinksCount}
                                        backlinkObject={backlinkObject}
                                    />
                                )}

                                {contact.isPrivate && (
                                    <PrivacyTag
                                        projectId={projectId}
                                        object={contact}
                                        objectType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
                                        style={{ marginLeft: 8 }}
                                        disabled={!loggedUserCanUpdateObject}
                                    />
                                )}

                                {!!commentsData && (
                                    <ContactCommentsWrapper
                                        commentsData={commentsData}
                                        projectId={projectId}
                                        contact={contact}
                                        isMember={isMember}
                                    />
                                )}
                            </View>
                        </Animated.View>
                    </TouchableOpacity>
                </Swipeable>

                <SwipeNewTaskWrapper
                    projectId={projectId}
                    objectId={contact.uid}
                    sourceType={isMember ? FEED_USER_OBJECT_TYPE : FEED_CONTACT_OBJECT_TYPE}
                    showPopup={showNewTaskPopup}
                    cancelPopover={this.cancelPopover}
                />
            </View>
        ) : null
    }
}

const localStyles = StyleSheet.create({
    container: {
        height: 90,
        paddingTop: 8,
        paddingBottom: 10,
        marginLeft: -8,
        marginRight: -8,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 4,
        flexDirection: 'row',
        overflow: 'hidden',
    },
    avatarContainer: {
        justifyContent: 'flex-start',
        overflow: 'hidden',
        width: 48,
        height: 48,
        borderRadius: 100,
    },
    image: {
        width: 48,
        height: 48,
        borderRadius: 100,
    },
    userData: {
        flex: 1,
        alignSelf: 'flex-start',
        marginLeft: 8,
    },
    name: {
        ...styles.body1,
        color: colors.Text01,
    },
    description: {
        ...styles.body2,
        color: colors.Text02,
    },
    updatedInfo: {
        color: colors.Text03,
    },
    buttonSection: {
        position: 'absolute',
        top: 8,
        right: 8,
        marginLeft: 8,
        flexDirection: 'row',
    },
    swipeContainer: {
        height: '100%',
        width: '100%',
        borderRadius: 4,
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftSwipeArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
        paddingLeft: 12,
    },
    rightSwipeAreaContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    rightSwipeArea: {
        flexDirection: 'row',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityYellow100,
        borderRadius: 4,
        paddingRight: 12,
    },
})
