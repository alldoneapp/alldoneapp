import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import moment from 'moment'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import store from '../../redux/store'
import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import Button from '../UIControls/Button'
import CloseButton from './CloseButton'
import AttachmentsTag from './AttachmentsTag'
import FollowUpDueDate from './FollowUpDueDate'
import CustomFollowUpDateModal from './CustomFollowUpDateModal'
import { OPEN_STEP, DONE_STEP, getTaskAutoEstimation, BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { setLastSelectedDueDate, showTaskCompletionAnimation } from '../../redux/actions'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { updateNewAttachmentsData, STAYWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { FOLLOW_UP_MODAL_ID, MENTION_MODAL_ID, removeModal, storeModal } from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'
import { getEstimationIconByValue } from '../../utils/EstimationHelper'
import { createFollowUpTask, moveTasksFromOpen, setTaskAutoEstimation } from '../../utils/backends/Tasks/tasksFirestore'

const TODAY = 'Today'
const TOMORROW = 'Tomorrow'

export default function FollowUpModal({ projectId, task, checkBoxId, cancelPopover, hidePopover }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [inComments, setInComments] = useState(false)
    const [inEstimation, setInEstimation] = useState(false)
    const [inDueDate, setInDueDate] = useState(false)
    const [inCalendar, setInCalendar] = useState(false)
    const [comment, setComment] = useState('')
    const [commentIsPrivate, setCommentIsPrivate] = useState(false)
    const [hasKarma, setHasKarma] = useState(false)
    const initialEstimation =
        task && task.estimations && task.estimations[OPEN_STEP] !== undefined ? task.estimations[OPEN_STEP] : 0
    const [estimation, setEstimation] = useState(initialEstimation)
    const [dateTimestamp, setDateTimestamp] = useState(0)
    const [dateText, setDateText] = useState('')

    const getCommentAndFiles = (comment, mentions, commentIsPrivate, hasKarma) => {
        setTimeout(() => {
            setComment(comment)
            setCommentIsPrivate(commentIsPrivate)
            setHasKarma(hasKarma)
            setInComments(false)
        })
    }

    const openCommentsPopover = e => {
        e.preventDefault()
        e.stopPropagation()
        setInComments(true)
    }

    const closeCommentsPopover = e => {
        setTimeout(() => {
            const { isQuillTagEditorOpen, openModals } = store.getState()
            if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
                if (e) {
                    e.preventDefault()
                    e.stopPropagation()
                }
                setInComments(false)
            }
        })
    }

    const removeComment = () => {
        setComment('')
    }

    const openEstimationPopover = () => {
        setInEstimation(true)
    }

    const closeEstimationPopover = () => {
        setInEstimation(false)
    }

    const openDueDatePopover = () => {
        setInDueDate(true)
    }

    const closeDueDatePopover = () => {
        setInDueDate(false)
    }

    const removeDate = () => {
        setDateTimestamp(0)
        setDateText('')
    }

    const onCustomDatePress = () => {
        setInCalendar(true)
        setInDueDate(false)
    }

    const backToDueDate = () => {
        setInCalendar(false)
        setInDueDate(true)
    }

    const selectDate = (dateText, date) => {
        if (date === BACKLOG_DATE_NUMERIC) {
            selectBacklog(dateText, date)
        } else {
            const dateTimestamp = date.valueOf()
            dispatch(setLastSelectedDueDate(dateTimestamp))
            setDateTimestamp(dateTimestamp)
            setDateText(dateText)
            setInDueDate(false)
            setInCalendar(false)
        }
    }

    const selectBacklog = (dateText, date) => {
        dispatch(setLastSelectedDueDate(BACKLOG_DATE_NUMERIC))
        setDateTimestamp(BACKLOG_DATE_NUMERIC)
        setDateText(dateText)
        setInDueDate(false)
        setInCalendar(false)
    }

    const closeCalender = () => {
        setInCalendar(false)
    }

    const formatDate = () => {
        if (dateTimestamp === Number.MAX_SAFE_INTEGER) {
            return 'Someday'
        } else if (dateText === TODAY || dateText === TOMORROW) {
            return dateText
        } else {
            return moment(dateTimestamp).format('DD MMM')
        }
    }

    const commentShortcut = (sht, event) => {
        if (event != null) {
            event.preventDefault()
            event.stopPropagation()
        }
        setInComments(true)
    }

    const followUpModalOnEnter = e => {
        if (e.key === 'Enter' && !inComments && !inEstimation) {
            if (inDueDate || inCalendar) {
                setInComments(false)
                setInDueDate(false)
                setInCalendar(false)
            } else {
                onDonePress()
            }
        }
    }

    const onDonePress = () => {
        hidePopover()
        updateNewAttachmentsData(projectId, comment).then(commentWithAttachments => {
            const needToCreateFolloUpTask = dateTimestamp
            if (estimation === undefined) {
                // Defensive logging to validate missing OPEN_STEP estimation on some tasks (e.g., MCP-created)
                // Ensures we never write undefined to Firestore maps
                console.warn('[FollowUpModal] Undefined estimation detected; defaulting to 0.', {
                    taskId: task?.id,
                    projectId,
                })
            }
            const safeEstimation = estimation ?? 0
            const estimations = { [OPEN_STEP]: safeEstimation }

            // Show completion animation
            store.dispatch(showTaskCompletionAnimation())

            moveTasksFromOpen(
                projectId,
                task,
                DONE_STEP,
                needToCreateFolloUpTask ? null : commentWithAttachments,
                needToCreateFolloUpTask ? null : STAYWARD_COMMENT,
                estimations,
                checkBoxId
            )
            if (needToCreateFolloUpTask) {
                createFollowUpTask(projectId, task, dateTimestamp, commentWithAttachments, safeEstimation)
            }
        })
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    useEffect(() => {
        document.addEventListener('keydown', followUpModalOnEnter)
        return () => {
            document.removeEventListener('keydown', followUpModalOnEnter)
        }
    })

    useEffect(() => {
        storeModal(FOLLOW_UP_MODAL_ID)
        return () => {
            removeModal(FOLLOW_UP_MODAL_ID)
        }
    }, [])

    return inComments ? (
        <RichCommentModal
            projectId={projectId}
            objectType={'tasks'}
            objectId={task.id}
            closeModal={closeCommentsPopover}
            processDone={getCommentAndFiles}
            currentComment={comment}
            currentMentions={[]}
            currentPrivacy={commentIsPrivate}
            currentKarma={hasKarma}
            inTaskModal={true}
            userGettingKarmaId={task.userId}
            externalAssistantId={task.assistantId}
            objectName={task.name}
        />
    ) : inEstimation ? (
        <EstimationModal
            projectId={projectId}
            estimation={estimation}
            setEstimationFn={setEstimation}
            closePopover={closeEstimationPopover}
            showBackButton={true}
            autoEstimation={getTaskAutoEstimation(projectId, estimation, task.autoEstimation)}
            setAutoEstimation={setAutoEstimation}
            showAutoEstimation={!task.isSubtask}
        />
    ) : inDueDate ? (
        <FollowUpDueDate
            closePopover={closeDueDatePopover}
            onCustomDatePress={onCustomDatePress}
            selectDate={selectDate}
            selectBacklog={selectBacklog}
            dateText={dateText}
        />
    ) : inCalendar ? (
        <CustomFollowUpDateModal hidePopover={closeCalender} selectDate={selectDate} backToDueDate={backToDueDate} />
    ) : (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.heading}>
                <View style={localStyles.title}>
                    <Text style={[styles.title7, { color: 'white', flex: 1 }]}>
                        {translate('Congrats, you have done it!')}
                    </Text>
                    <Text style={[styles.body2, { color: colors.Text03, flex: 1 }]}>
                        {translate('Select from the options below')}
                    </Text>
                </View>
                <CloseButton close={cancelPopover} />
            </View>

            <View style={localStyles.subsection}>
                <View style={[localStyles.estimationSection, { flexDirection: 'column' }]}>
                    <Hotkeys keyName={'1'} onKeyDown={commentShortcut} filter={e => true}>
                        <TouchableOpacity style={localStyles.estimation} onPress={openCommentsPopover}>
                            <Icon name="message-circle" size={24} color="white" />
                            <Text style={[styles.subtitle1, localStyles.uploadText]}>{translate('Add comment')}</Text>
                            <View style={{ marginLeft: 'auto' }}>
                                {smallScreenNavigation ? (
                                    <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                                ) : (
                                    <Shortcut text={'1'} theme={SHORTCUT_LIGHT} />
                                )}
                            </View>
                        </TouchableOpacity>
                    </Hotkeys>

                    {comment !== '' ? (
                        <View style={localStyles.commentSection}>
                            {comment !== '' ? (
                                <View style={{ marginRight: 4 }}>
                                    <AttachmentsTag
                                        text={comment.substring(0, 20)}
                                        removeTag={removeComment}
                                        ico="message-circle"
                                        maxWidth={133}
                                    />
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                </View>

                <View style={[localStyles.estimationSection, localStyles.estimationContainer]}>
                    <Hotkeys keyName={'2'} onKeyDown={openEstimationPopover} filter={e => true}>
                        <TouchableOpacity style={localStyles.estimation} onPress={openEstimationPopover}>
                            <Icon
                                name={`count-circle-${getEstimationIconByValue(projectId, estimation)}`}
                                size={24}
                                color="white"
                            />
                            <Text style={[styles.subtitle1, localStyles.uploadText]}>
                                {translate('Change estimation')}
                            </Text>
                            <View style={{ marginLeft: 'auto' }}>
                                {smallScreenNavigation ? (
                                    <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                                ) : (
                                    <Shortcut text={'2'} theme={SHORTCUT_LIGHT} />
                                )}
                            </View>
                        </TouchableOpacity>
                    </Hotkeys>
                </View>

                <View style={localStyles.itemsContainer}>
                    <Hotkeys key={'r3'} keyName={'3'} onKeyDown={openDueDatePopover} filter={e => true}>
                        <TouchableOpacity style={localStyles.estimation} onPress={openDueDatePopover}>
                            <Icon name="calendar" size={24} color="white" />
                            <Text style={[styles.subtitle1, localStyles.uploadText]}>{translate('Follow up')}</Text>
                            <View style={{ marginLeft: 'auto' }}>
                                {smallScreenNavigation ? (
                                    <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                                ) : (
                                    <Shortcut text={'3'} theme={SHORTCUT_LIGHT} />
                                )}
                            </View>
                        </TouchableOpacity>
                    </Hotkeys>

                    {dateTimestamp ? (
                        <View style={{ marginTop: 9 }}>
                            <AttachmentsTag text={formatDate()} removeTag={removeDate} ico="calendar" />
                        </View>
                    ) : null}
                </View>

                <View style={localStyles.doneButtonContainer}>
                    <Button
                        title={translate('I am all done')}
                        type={'primary'}
                        onPress={() => {
                            setTimeout(onDonePress, 100)
                        }}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 305,
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    heading: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flex: 1,
        flexDirection: 'column',
        marginTop: 8,
    },
    estimationContainer: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    itemsContainer: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    subsection: {
        marginTop: 20,
        paddingHorizontal: 16,
    },
    uploadText: {
        color: 'white',
        marginLeft: 8,
    },
    doneButtonContainer: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
    estimation: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    estimationSection: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    commentSection: {
        marginTop: 10,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        overflow: 'hidden',
        flexWrap: 'wrap',
    },
})
