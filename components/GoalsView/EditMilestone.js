import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { cloneDeep } from 'lodash'
import Hotkeys from 'react-hot-keys'
import v4 from 'uuid/v4'
import moment from 'moment'

import { colors } from '../styles/global'
import Backend from '../../utils/BackendBridge'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { GOAL_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import CancelButton from './EditGoalsComponents/CancelButton'
import DoneButton from './EditGoalsComponents/DoneButton'
import OrganizationWrapper from './OrganizationWrapper'
import { getOwnerId } from './GoalsHelper'
import Button from '../UIControls/Button'
import { execShortcutFn } from '../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { setMilestoneInEditionId } from '../../redux/actions'
import HighlightButton from '../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import { FEED_MILESTONE_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import { MILESTONE_TAG_TRIGGER } from '../Feeds/Utils/HelperFunctions'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import { useSelector, useDispatch } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

export default function EditMilestone({ milestone, onCancelAction, projectId }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [tmpMilestone, setTmpMilestone] = useState(() => {
        const tmpMilestone = cloneDeep(milestone)
        tmpMilestone.ownerId = getOwnerId(projectId, currentUserId)
        return tmpMilestone
    })

    const setDeltas = (delta, quillRef, editorId, userIdAllowedToEditTags) => {
        const date = moment(tmpMilestone.date)
        const dateText = date.format(getDateFormat())
        const deltas = quillRef?.current?.getContents()
        if (!deltas.ops[0]?.insert?.milestoneTag) {
            const id = v4()
            const milestoneTag = { text: dateText, id, editorId, milestoneId: tmpMilestone.id, userIdAllowedToEditTags }
            deltas.ops.unshift({ insert: { milestoneTag } })
            quillRef?.current?.setContents(deltas)
        }
    }

    const cleanMilestoneTag = extendedName => {
        const chunks = extendedName.split(' ')
        chunks.splice(0, 1)
        return chunks.join(' ')
    }

    const onSelectionChange = (selection, quillRef) => {
        const { index, length } = selection
        if (index === 0) {
            quillRef.current.setSelection(1, length > 0 ? length - 1 : 0, 'user')
        }
    }

    const actionDoneButton = () => {
        milestoneHasValidChanges() ? updateMilestone({ ...tmpMilestone }) : onCancelAction()
    }

    const milestoneHasValidChanges = () => {
        const cleanedName = cleanMilestoneTag(tmpMilestone.extendedName).trim()
        return cleanedName !== milestone.extendedName.trim()
    }

    const updateMilestone = updatedMilestone => {
        updatedMilestone.extendedName = cleanMilestoneTag(updatedMilestone.extendedName)
        Backend.updateMilestone(projectId, updatedMilestone)
        setTimeout(() => {
            onCancelAction()
        })
    }

    const setName = extendedName => {
        setTmpMilestone(tmpMilestone => {
            return { ...tmpMilestone, extendedName }
        })
    }

    const updateDate = async date => {
        if (tmpMilestone.date !== date) {
            const updatedMilestone = {
                ...tmpMilestone,
                extendedName: cleanMilestoneTag(tmpMilestone.extendedName),
            }
            date === BACKLOG_DATE_NUMERIC
                ? Backend.updateMilestoneDateToBacklog(projectId, updatedMilestone)
                : Backend.updateMilestoneDate(projectId, updatedMilestone, date)
            onCancelAction()
        }
    }

    const updateThisAndLaterMilestones = async date => {
        if (tmpMilestone.date !== date) {
            const updatedMilestone = {
                ...tmpMilestone,
                extendedName: cleanMilestoneTag(tmpMilestone.extendedName),
            }
            date === BACKLOG_DATE_NUMERIC
                ? Backend.updateFutureOpenMilestonesDateToBacklog(projectId, updatedMilestone)
                : Backend.updateFutureOpenMilestonesDate(projectId, updatedMilestone, date)
            onCancelAction()
        }
    }

    const updateHighlightColor = color => {
        if (tmpMilestone.hasStar !== color) {
            const finalMilestone = { ...tmpMilestone, hasStar: color }
            updateMilestone(finalMilestone)
        }
    }

    const updateDoneState = async () => {
        const updatedMilestone = {
            ...tmpMilestone,
            extendedName: cleanMilestoneTag(tmpMilestone.extendedName),
        }
        Backend.updateMilestoneDoneState(projectId, updatedMilestone)
        onCancelAction()
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            enterKeyAction()
        }
    }

    const enterKeyAction = () => {
        if (showFloatPopup === 0) actionDoneButton()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            return document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        dispatch(setMilestoneInEditionId(milestone.id))
        return () => {
            dispatch(setMilestoneInEditionId(''))
        }
    }, [])

    useEffect(() => {
        if (showGlobalSearchPopup) onCancelAction()
    }, [showGlobalSearchPopup])

    const buttonItemStyle = { marginHorizontal: smallScreen ? 4 : 2 }
    const date = moment(tmpMilestone.date)
    const dateText = date.format(getDateFormat())
    const initialTextExtended = `${MILESTONE_TAG_TRIGGER}${dateText}${MILESTONE_TAG_TRIGGER}${tmpMilestone.id} ${tmpMilestone.extendedName}`
    const hasChanges = milestoneHasValidChanges()

    return (
        <View style={[localStyles.container, smallScreenNavigation && localStyles.containerUnderBreakpoint]}>
            <View style={localStyles.inputContainer}>
                <CustomTextInput3
                    placeholder={translate('Write the title of the milestone')}
                    onChangeText={setName}
                    onChangeDelta={setDeltas}
                    autoFocus={true}
                    projectId={projectId}
                    containerStyle={localStyles.textInputContainer}
                    initialTextExtended={initialTextExtended}
                    styleTheme={GOAL_THEME}
                    otherFormats={['milestoneTag']}
                    onCustomSelectionChange={onSelectionChange}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                />
            </View>
            <View style={localStyles.buttonContainer}>
                <View style={[localStyles.buttonSection]}>
                    <OrganizationWrapper
                        projectId={projectId}
                        updateDate={updateDate}
                        updateThisAndLaterMilestones={updateThisAndLaterMilestones}
                        milestone={tmpMilestone}
                    />
                    <Hotkeys
                        keyName={'alt+shift+D'}
                        onKeyDown={(sht, event) => execShortcutFn(this.doneMilestioneBtnRef, updateDoneState, event)}
                        filter={e => true}
                    >
                        <Button
                            ref={ref => (this.doneMilestioneBtnRef = ref)}
                            icon={tmpMilestone.done ? 'square-checked-gray' : 'square'}
                            title={smallScreen ? null : translate('Done mile')}
                            type={'ghost'}
                            buttonStyle={buttonItemStyle}
                            noBorder={smallScreen}
                            onPress={updateDoneState}
                            shortcutText={'Shift+D'}
                        />
                    </Hotkeys>
                    <HighlightButton
                        projectId={projectId}
                        object={tmpMilestone}
                        objectType={FEED_MILESTONE_OBJECT_TYPE}
                        updateHighlight={updateHighlightColor}
                        inEditComponent={true}
                        style={buttonItemStyle}
                        shortcutText={'H'}
                    />
                </View>
                <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                    <CancelButton onCancelAction={onCancelAction} />
                    <DoneButton needUpdate={hasChanges} actionDoneButton={actionDoneButton} />
                </View>
            </View>
        </View>
    )
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
        paddingVertical: 7,
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
        paddingLeft: 19,
        paddingRight: 16,
        paddingTop: 3,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    textInputContainer: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 44.5,
        marginTop: 3.5,
        marginBottom: 8,
    },
})
