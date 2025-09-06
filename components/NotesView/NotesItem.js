import React, { useEffect, useRef, useState } from 'react'
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import moment from 'moment'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import SocialText from '../UIControls/SocialText/SocialText'
import { useDispatch, useSelector } from 'react-redux'
import SharedHelper from '../../utils/SharedHelper'
import BacklinksTag from '../Tags/BacklinksTag'
import PrivacyTag from '../Tags/PrivacyTag'
import { FEED_NOTE_OBJECT_TYPE, FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import ProjectHelper, { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { setPrevScreen, setSelectedNavItem, setSelectedNote, startLoadingData } from '../../redux/actions'
import { DV_TAB_NOTE_EDITOR } from '../../utils/TabNavigationConstants'
import NavigationService from '../../utils/NavigationService'
import SwipeNewTaskWrapper from './SwipeNewTaskWrapper'
import { exitsOpenModals, removeModal, RICH_CREATE_TASK_MODAL_ID, storeModal } from '../ModalsManager/modalsManager'
import { LINKED_OBJECT_TYPE_NOTE, getDvNoteTabLink } from '../../utils/LinkingHelper'
import useBacklinks from '../../hooks/useBacklinks'
import { openNoteDV } from './NotesDV/EditorView/notesHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../RootView/Themes'
import LastEditionData from './LastEditionData'

const NotesItem = ({ openEditModal, note, project, ignoreAccessGranted }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const dispatch = useDispatch()
    const isSticky = note.stickyData.days > 0 && checkIfSelectedProject(selectedProjectIndex)
    let hasTasks = false
    const trimmedPreview = note.preview.trim()
    const emptyNote = !hasTasks && trimmedPreview.length === 0
    const noteOwner = TasksHelper.getUserInProject(project.id, note.userId)
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)
    const { backlinksTasksCount, backlinkTaskObject, backlinksNotesCount, backlinkNoteObject } = useBacklinks(
        project.id,
        LINKED_OBJECT_TYPE_NOTE,
        'linkedParentNotesIds',
        note.id
    )
    const [blockOpen, setBlockOpen] = useState(false)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const showNewTaskPopup = useRef(false)
    const isUnmountedRef = useRef(false)
    const rightSwipeTimeoutRef = useRef(null)
    const [renderFlag, setRenderFlag] = useState(false)
    const itemSwipe = useRef()
    const theme = getTheme(Themes, loggedUser.themeName, 'RootView.StickyItem')

    const outputColors = [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125]
    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: outputColors,
        extrapolate: 'clamp',
    })

    const backColorHighlight = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: [colors.UtilityYellow125, note.hasStar, colors.UtilityGreen125],
        extrapolate: 'clamp',
    })
    const highlightColor = note.hasStar.toLowerCase() !== '#ffffff' ? backColorHighlight : backColor

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            if (rightSwipeTimeoutRef.current) {
                clearTimeout(rightSwipeTimeoutRef.current)
            }
            // Debug: track unmount to diagnose setState-after-unmount
            console.debug('NotesItem unmounted', { noteId: note.id })
        }
    }, [])

    const openObjectNote = () => {
        dispatch(startLoadingData())

        const url = getDvNoteTabLink(
            project.id,
            note.parentObject.id,
            note.parentObject.type === 'topics' ? 'chats' : note.parentObject.type
        )
        URLTrigger.processUrl(NavigationService, url)
    }

    const onOpenNoteDV = () => {
        if (showFloatPopup === 0 && !blockOpen && !exitsOpenModals()) {
            if (note.parentObject) {
                openObjectNote()
            } else {
                openNoteDV(project, note)
            }
        } else {
            dismissAllPopups(true, true, true)
        }
    }

    const onOpenEditModal = () => {
        if (showFloatPopup === 0 && openEditModal && !blockOpen && !exitsOpenModals()) {
            openEditModal()
        } else {
            dismissAllPopups(true, true, true)
        }
    }

    const forceRender = () => {
        setRenderFlag(!renderFlag)
    }

    const renderRightSwipe = (progress, dragX) => {
        if (panColor !== dragX) {
            setPanColor(dragX)
        }

        return <View style={{ width: 150 }} />
    }

    const renderLeftSwipe = (progress, dragX) => {
        if (panColor !== dragX) {
            setPanColor(dragX)
        }

        return <View style={{ width: 150 }} />
    }

    const onRightSwipe = () => {
        itemSwipe.current.close()
        rightSwipeTimeoutRef.current = setTimeout(() => {
            storeModal(RICH_CREATE_TASK_MODAL_ID)
            showNewTaskPopup.current = true
        })
    }

    const onLeftSwipe = () => {
        itemSwipe.current.close()
        if (note.parentObject) {
            openObjectNote()
        } else {
            dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setPrevScreen('NotesView'), setSelectedNote(note)])
            NavigationService.navigate('NotesDetailedView', {
                noteId: note.id,
                projectId: project.id,
            })
        }
    }

    const cancelPopover = () => {
        removeModal(RICH_CREATE_TASK_MODAL_ID)
        showNewTaskPopup.current = false
        if (isUnmountedRef.current) {
            console.warn('NotesItem.cancelPopover called after unmount', { noteId: note.id })
            return
        }
        forceRender()
    }

    const renderIcon = () => {
        if (note.parentObject) {
            switch (note.parentObject.type) {
                case 'tasks':
                    return 'check-square'
                case 'goals':
                    return 'target'
                case 'users':
                    return 'users'
                case 'contacts':
                    return 'user-aster'
                case 'topics':
                    return 'comments-thread'
                case 'skills':
                    return 'star'
                case 'assistants':
                    return 'cpu'
            }
        } else return 'file-text'
    }

    const backlinksCount = backlinksTasksCount + backlinksNotesCount
    const backlinkObject =
        backlinksCount === 1 ? (backlinksTasksCount === 1 ? backlinkTaskObject : backlinkNoteObject) : null

    const loggedUserIsCreator = loggedUser.uid === note.creatorId
    const loggedUserCanUpdateObject =
        !note.linkedToTemplate &&
        (loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id))

    return (
        <View>
            <View style={localStyles.swipeContainer}>
                <View style={localStyles.leftSwipeArea}>
                    <Icon name={'circle-details'} size={18} color={colors.UtilityGreen200} />
                    <View style={{ marginLeft: 4 }}>
                        <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>Details</Text>
                    </View>
                </View>

                <View style={localStyles.rightSwipeArea}>
                    <View style={localStyles.rightSwipeAreaContainer}>
                        <Icon name={'check-square'} size={18} color={colors.UtilityYellow200} />
                        <View style={{ marginLeft: 4 }}>
                            <Text style={[styles.subtitle2, { color: colors.UtilityYellow200 }]}>Add task</Text>
                        </View>
                    </View>
                </View>
            </View>

            <Swipeable
                ref={itemSwipe}
                rightThreshold={80}
                leftThreshold={80}
                enabled={true}
                renderLeftActions={renderLeftSwipe}
                renderRightActions={renderRightSwipe}
                onSwipeableLeftWillOpen={onLeftSwipe}
                onSwipeableRightWillOpen={onRightSwipe}
                overshootLeft={false}
                overshootRight={false}
                friction={2}
                containerStyle={{ overflow: 'visible' }}
                failOffsetY={[-5, 5]}
                onSwipeableWillClose={() => setBlockOpen(true)}
                onSwipeableClose={() => setBlockOpen(false)}
            >
                <Animated.View
                    style={[
                        localStyles.container,
                        { backgroundColor: highlightColor },
                        isSticky && [localStyles.containerSticky, theme.containerSticky(project.color)],
                    ]}
                >
                    <TouchableOpacity
                        style={localStyles.subContainer}
                        onPress={onOpenNoteDV}
                        disabled={blockOpen || ignoreAccessGranted ? false : !accessGranted}
                        activeOpacity={blockOpen ? 1 : 0.5}
                        accessible={false}
                    >
                        <View style={{ flexDirection: 'column', width: '100%' }}>
                            <View style={localStyles.titleContainer}>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity
                                        onPress={onOpenEditModal}
                                        disabled={blockOpen || ignoreAccessGranted ? false : !accessGranted}
                                        activeOpacity={blockOpen ? 1 : 0.5}
                                        accessible={false}
                                    >
                                        <Icon
                                            name={isSticky ? 'sticky-note' : renderIcon()}
                                            size={24}
                                            color={colors.Text03}
                                        />
                                    </TouchableOpacity>
                                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                                        <SocialText
                                            style={[styles.body1, { color: colors.Text01 }]}
                                            numberOfLines={1}
                                            showEllipsis={true}
                                            task={{ linkBack: '' }}
                                            inTaskDetailedView={false}
                                            projectId={project.id}
                                            hasStar={note.hasStar}
                                            bgColor={note.hasStar ? backColorHighlight : backColor}
                                        >
                                            {note !== undefined && (note.title != null || note.extendedTitle != null)
                                                ? note.extendedTitle != null && note.extendedTitle !== ''
                                                    ? note.extendedTitle
                                                    : note.title
                                                : ''}
                                        </SocialText>
                                    </View>
                                    <View style={{ flexDirection: 'row', marginLeft: 'auto' }}>
                                        {note.isPrivate && (
                                            <PrivacyTag
                                                projectId={project.id}
                                                object={note}
                                                objectType={FEED_NOTE_OBJECT_TYPE}
                                                disabled={
                                                    !accessGranted || note.parentObject || !loggedUserCanUpdateObject
                                                }
                                                style={{ marginLeft: 8 }}
                                            />
                                        )}
                                        {backlinksCount > 0 && (
                                            <BacklinksTag
                                                object={note}
                                                objectType={LINKED_OBJECT_TYPE_NOTE}
                                                projectId={project.id}
                                                style={{ marginLeft: 8 }}
                                                disabled={!accessGranted}
                                                backlinksCount={backlinksCount}
                                                backlinkObject={backlinkObject}
                                            />
                                        )}
                                        <View style={localStyles.userImageContainer}>
                                            <Image
                                                source={{ uri: noteOwner?.photoURL }}
                                                style={localStyles.userImage}
                                            />
                                        </View>
                                    </View>
                                </View>
                            </View>
                            <View style={localStyles.notePreview}>
                                <View style={{ flex: 1, marginLeft: 8 }}>
                                    <SocialText
                                        style={localStyles.description}
                                        normalStyle={{ whiteSpace: 'normal' }}
                                        numberOfLines={1}
                                        projectId={project.id}
                                        hasStar={note.hasStar}
                                        bgColor={note.hasStar ? backColorHighlight : backColor}
                                        inFeedComment={true}
                                        showEllipsis={true}
                                    >
                                        {emptyNote
                                            ? 'This note has no content'
                                            : !note.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                                            ? 'Private note'
                                            : note.preview}
                                    </SocialText>
                                </View>
                            </View>

                            <LastEditionData note={note} projectId={project.id} />
                        </View>
                    </TouchableOpacity>
                </Animated.View>
            </Swipeable>

            <SwipeNewTaskWrapper
                projectId={project.id}
                objectId={note.id}
                sourceType={FEED_NOTE_OBJECT_TYPE}
                showPopup={showNewTaskPopup.current}
                cancelPopover={cancelPopover}
            />
        </View>
    )
}

const parseDate = date => {
    if (Date.now() - date < 60) {
        return 'Just now'
    }

    return `Edited: ${moment(date).format(`${getTimeFormat(true)} of ${getDateFormat()}`)}`
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 92,
        flexDirection: 'row',
        justifyContent: 'space-between',
        flex: 1,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 4,
        marginHorizontal: -8,
        paddingHorizontal: 8,
        overflow: 'hidden',
    },
    subContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        overflow: 'hidden',
    },
    containerSticky: {
        borderRadius: 4,
        paddingHorizontal: 8,
        marginLeft: -8,
        marginRight: -8,
    },
    titleContainer: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    notePreview: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        marginLeft: 28,
        maxHeight: 32,
        paddingTop: 4,
        paddingBottom: 6,
    },
    description: {
        ...styles.body2,
        color: colors.Text02,
        display: 'flex',
        whiteSpace: 'normal',
    },
    dateAndSubHint: {
        flex: 1,
        marginLeft: 36,
        maxHeight: 20,
        paddingBottom: 6,
        flexDirection: 'row',
        alignItems: 'flex-start',
        overflow: 'hidden',
    },
    subHintText: {
        color: colors.Text03,
        alignItems: 'flex-start',
    },
    userImageContainer: {
        marginLeft: 8,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
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

export default NotesItem
