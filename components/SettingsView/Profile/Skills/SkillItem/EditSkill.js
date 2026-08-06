import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'
import { cloneDeep, isEqual } from 'lodash'

import DoneButton from '../../../../GoalsView/EditGoalsComponents/DoneButton'
import CancelButton from '../../../../GoalsView/EditGoalsComponents/CancelButton'
import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'
import CustomTextInput3 from '../../../../Feeds/CommentsTextInput/CustomTextInput3'
import Icon from '../../../../Icon'
import { GOAL_THEME } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import { colors } from '../../../../styles/global'
import { getNewDefaultSkill } from '../SkillsHelper'
import Backend from '../../../../../utils/BackendBridge'
import PrivacyButton from '../../../../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import { FEED_SKILL_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import SkillPointsWrapper from '../SkillPointsWrapper/SkillPointsWrapper'
import HighlightButton from '../../../../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import CommentWrapper from '../CommentWrapper'
import DescriptionWrapper from '../DescriptionWrapper'
import SkillMoreButton from '../SkillMoreButton/SkillMoreButton'
import CopySkillLinkButton from '../CopySkillLinkButton'
import FollowSkillButton from '../FollowSkillButton'
import NavigationService from '../../../../../utils/NavigationService'
import { setSelectedNavItem, startLoadingData, stopLoadingData } from '../../../../../redux/actions'
import SharedHelper from '../../../../../utils/SharedHelper'
import { DV_TAB_SKILL_PROPERTIES } from '../../../../../utils/TabNavigationConstants'

export default function EditSkill({ refKey, projectId, adding, skill, onCancelAction }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [tmpSkill, setTmpSkill] = useState(() => (adding ? getNewDefaultSkill(projectId) : cloneDeep(skill)))

    const accessGranted = SharedHelper.accessGranted(null, projectId)

    const skillHasValidChanges = () => {
        const cleanedName = tmpSkill.extendedName.trim()
        return adding ? cleanedName !== '' : cleanedName !== '' && cleanedName !== skill.extendedName.trim()
    }

    const setName = extendedName => {
        setTmpSkill(tmpSkill => {
            return { ...tmpSkill, extendedName }
        })
    }

    const hasChanges = skillHasValidChanges()

    const actionDoneButton = () => {
        hasChanges
            ? adding
                ? createSkill({ ...tmpSkill }, null)
                : updateSkill({ ...tmpSkill }, false)
            : onCancelAction()
    }

    const createSkill = async (newSkill, callback) => {
        const skill = Backend.uploadNewSkill(projectId, newSkill, false, null, callback, true)
        setTimeout(() => {
            onCancelAction()
        })
        return skill
    }

    const updateSkill = (updatedSkill, avoidFollow) => {
        Backend.updateSkill(projectId, skill, updatedSkill, avoidFollow)
        setTimeout(() => {
            onCancelAction()
        })
    }

    const updatePoints = pointsToAdd => {
        updateSkill({ ...tmpSkill, points: tmpSkill.points + pointsToAdd }, false)
    }

    const updatePrivacy = (isPrivate, isPublicFor) => {
        if (!isEqual(tmpSkill.isPublicFor, isPublicFor)) {
            const finalSkill = { ...tmpSkill, isPublicFor }
            adding ? createSkill(finalSkill, null) : updateSkill(finalSkill, false)
        }
    }

    const updateHighlight = color => {
        if (tmpSkill.hasStar !== color) {
            const finalSkill = { ...tmpSkill, hasStar: color }
            adding ? createSkill(finalSkill, null) : updateSkill(finalSkill, false)
        }
    }

    const updateDescription = description => {
        if (tmpSkill.description !== description) {
            const finalSkill = { ...tmpSkill, description }
            adding ? createSkill(finalSkill, null) : updateSkill(finalSkill, false)
        }
    }

    const updateCompletion = (completion, addedComment) => {
        setTimeout(() => {
            if (tmpSkill.completion !== completion) {
                updateSkill({ ...tmpSkill, completion }, false)
            } else if (addedComment) {
                updateCurrentChanges()
            }
        })
    }

    const updateFollowState = () => {
        hasChanges ? updateSkill({ ...tmpSkill }, true) : onCancelAction()
    }

    const updateCurrentChanges = () => {
        hasChanges ? updateSkill({ ...tmpSkill }, false) : onCancelAction()
    }

    const openDvWhenCreateOrUpdateSkill = skill => {
        dispatch(stopLoadingData())
        NavigationService.navigate('SkillDetailedView', {
            skillId: skill.id,
            projectId,
            skill,
        })
        dispatch(setSelectedNavItem(DV_TAB_SKILL_PROPERTIES))
    }

    const openDV = () => {
        const finalSkill = { ...tmpSkill }
        dispatch(startLoadingData())
        if (adding) {
            createSkill(finalSkill, openDvWhenCreateOrUpdateSkill)
        } else {
            if (hasChanges) updateSkill(finalSkill, false)
            openDvWhenCreateOrUpdateSkill(finalSkill)
        }
        onCancelAction()
    }

    const enterKeyAction = () => {
        if (showFloatPopup === 0) actionDoneButton()
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            enterKeyAction()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            return document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        if (showGlobalSearchPopup) onCancelAction()
    }, [showGlobalSearchPopup])

    const disableButtons = !tmpSkill.extendedName.trim()
    const isSkillsOwner = !isAnonymous && tmpSkill.userId === loggedUserId

    return (
        <View style={[localStyles.container, smallScreenNavigation ? localStyles.containerUnderBreakpoint : undefined]}>
            <View style={adding ? localStyles.inputContainerAdding : localStyles.inputContainer}>
                {adding && (
                    <Icon
                        style={[localStyles.icon, smallScreenNavigation && localStyles.iconMobile]}
                        name={'plus-square'}
                        size={24}
                        color={colors.Primary100}
                    />
                )}
                <CustomTextInput3
                    placeholder={translate(adding ? 'Type to add new skill' : 'Write the title of the skill')}
                    onChangeText={setName}
                    autoFocus={true}
                    projectId={projectId}
                    containerStyle={[localStyles.textInputContainer, adding && localStyles.textInputContainerAdding]}
                    initialTextExtended={tmpSkill.extendedName}
                    styleTheme={GOAL_THEME}
                    disabledEdition={!isSkillsOwner}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                />
                {!adding && (
                    <SkillPointsWrapper
                        skill={tmpSkill}
                        projectId={projectId}
                        disabled={!isSkillsOwner}
                        updateSkillPoints={updatePoints}
                        points={tmpSkill.points}
                        buttonStyle={{ marginTop: 3.5 }}
                    />
                )}
            </View>
            <View style={localStyles.buttonContainer}>
                <View style={[localStyles.buttonSection]}>
                    <View style={smallScreen ? undefined : { marginRight: 32 }}>
                        <Hotkeys
                            keyName={'alt+O'}
                            disabled={adding && !hasChanges}
                            onKeyDown={(sht, event) => execShortcutFn(this.openBtnRef, openDV, event)}
                            filter={e => true}
                        >
                            <Button
                                ref={ref => (this.openBtnRef = ref)}
                                title={smallScreen ? null : translate('Open nav')}
                                type={'secondary'}
                                noBorder={smallScreen}
                                icon={'maximize-2'}
                                buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                                onPress={openDV}
                                disabled={adding && !hasChanges}
                                shortcutText={'O'}
                            />
                        </Hotkeys>
                    </View>

                    {!isAnonymous && (
                        <>
                            {!adding && (
                                <CommentWrapper
                                    updateCurrentChanges={updateCurrentChanges}
                                    projectId={projectId}
                                    skillId={tmpSkill.id}
                                    disabled={disableButtons}
                                    userGettingKarmaId={tmpSkill.userId}
                                    skillName={tmpSkill.name}
                                    assistantId={tmpSkill.assistantId}
                                />
                            )}
                            {isSkillsOwner && (
                                <PrivacyButton
                                    projectId={projectId}
                                    object={tmpSkill}
                                    objectType={FEED_SKILL_OBJECT_TYPE}
                                    disabled={disableButtons}
                                    savePrivacyBeforeSaveObject={updatePrivacy}
                                    inEditComponent={true}
                                    style={{ marginHorizontal: smallScreen ? 4 : 2 }}
                                    shortcutText={'P'}
                                />
                            )}
                            {!adding && isSkillsOwner && (
                                <SkillPointsWrapper
                                    skill={tmpSkill}
                                    projectId={projectId}
                                    disabled={disableButtons}
                                    updateSkillPoints={updatePoints}
                                    points={tmpSkill.points}
                                    inButtonsArea={true}
                                />
                            )}
                            {adding && (
                                <HighlightButton
                                    projectId={projectId}
                                    object={tmpSkill}
                                    objectType={FEED_SKILL_OBJECT_TYPE}
                                    disabled={disableButtons}
                                    updateHighlight={updateHighlight}
                                    inEditComponent={true}
                                    style={{ marginHorizontal: smallScreen ? 4 : 2 }}
                                    shortcutText={'H'}
                                    closeWithDelay={true}
                                />
                            )}
                            {adding && (
                                <DescriptionWrapper
                                    skill={tmpSkill}
                                    updateDescription={updateDescription}
                                    projectId={projectId}
                                    disabled={disableButtons}
                                />
                            )}
                            {!adding && isSkillsOwner && (
                                <SkillMoreButton
                                    projectId={projectId}
                                    skill={tmpSkill}
                                    buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                                    closeParent={onCancelAction}
                                    disabled={disableButtons}
                                    updateDescription={updateDescription}
                                    updateCurrentChanges={updateCurrentChanges}
                                    updateHighlight={updateHighlight}
                                    refKey={refKey}
                                    isSkillsOwner={isSkillsOwner}
                                    updateFollowState={updateFollowState}
                                    updateCompletion={updateCompletion}
                                />
                            )}
                            {!isSkillsOwner && (
                                <CopySkillLinkButton
                                    projectId={projectId}
                                    skillId={tmpSkill.id}
                                    onCancelAction={onCancelAction}
                                />
                            )}
                            {!isSkillsOwner && accessGranted && (
                                <FollowSkillButton
                                    projectId={projectId}
                                    skill={tmpSkill}
                                    onCancelAction={onCancelAction}
                                />
                            )}
                        </>
                    )}
                </View>
                <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                    <CancelButton onCancelAction={onCancelAction} />
                    <DoneButton
                        needUpdate={hasChanges}
                        adding={adding}
                        actionDoneButton={actionDoneButton}
                        disabled={isAnonymous}
                    />
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
        marginLeft: -6,
        marginRight: -6,
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
    inputContainerAdding: {
        paddingHorizontal: 6,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    inputContainer: {
        paddingLeft: 19,
        paddingRight: 6,
        paddingTop: 3.5,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    icon: {
        marginLeft: 3,
        marginTop: 7,
    },
    iconMobile: {
        marginLeft: -5,
    },
    textInputContainerAdding: {
        marginLeft: 12,
        marginTop: 2,
        minHeight: 50,
    },
    textInputContainer: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 44.5,
        marginTop: 3.5,
        marginBottom: 8,
    },
})
