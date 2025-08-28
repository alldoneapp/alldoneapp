import React, { useState } from 'react'
import { cloneDeep, isEqual } from 'lodash'
import { StyleSheet, View } from 'react-native'

import Backend from '../../../utils/BackendBridge'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import SaveButton from '../Common/SaveButton'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import NavigationService from '../../../utils/NavigationService'
import { checkDVLink, getDvMainTabLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { getPathname } from '../../Tags/LinkTag'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_SKILL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CommentWrapper from '../../SettingsView/Profile/Skills/CommentWrapper'
import SkillPointsWrapper from '../../SettingsView/Profile/Skills/SkillPointsWrapper/SkillPointsWrapper'
import SkillMoreButton from '../../SettingsView/Profile/Skills/SkillMoreButton/SkillMoreButton'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'

export default function EditSkillLink({ projectId, skillData, closeModal, objectUrl }) {
    const [skill, setSkill] = useState(cloneDeep(skillData))

    const skillHasValidChanges = () => {
        const cleanedName = skill.extendedName.trim()
        return cleanedName && cleanedName !== skillData.extendedName.trim()
    }

    const onChangeText = extendedName => {
        setSkill(skill => ({ ...skill, extendedName }))
    }

    const updateSkill = (updatedGoal, avoidFollow) => {
        Backend.updateSkill(projectId, skillData, updatedGoal, avoidFollow)
        closeModal()
    }

    const updateCurrentChanges = () => {
        skillHasValidChanges() ? updateSkill({ ...skill }, false) : closeModal()
    }

    const updatePoints = pointsToAdd => {
        updateSkill({ ...skill, points: skill.points + pointsToAdd }, false)
    }

    const updateDescription = description => {
        const cleanedDescription = description.trim()
        if (skill.description.trim() !== cleanedDescription) {
            updateSkill({ ...skill, description: cleanedDescription }, false)
        }
    }

    const updateHighlight = color => {
        if (skill.hasStar !== color) {
            updateSkill({ ...skill, hasStar: color }, false)
        }
    }

    const updatePrivacy = (isPrivate, isPublicFor) => {
        if (!isEqual(skill.isPublicFor, isPublicFor)) {
            updateSkill({ ...skill, isPublicFor }, false)
        }
    }

    const updateCompletion = (completion, addedComment) => {
        setTimeout(() => {
            if (skill.completion !== completion) {
                updateSkill({ ...skill, completion }, false)
            } else if (addedComment) {
                updateCurrentChanges()
            }
        })
    }

    const updateFollowState = () => {
        hasChanges ? updateSkill({ ...skill }, true) : onCancelAction()
    }

    const openDV = () => {
        closeModal()
        checkDVLink('skill')
        const linkUrl = objectUrl != null ? getPathname(objectUrl) : getDvMainTabLink(projectId, skillData.id, 'skills')
        URLTrigger.processUrl(NavigationService, linkUrl)
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            updateCurrentChanges()
        }
    }

    const disableButtons = !skill.extendedName.trim()

    return (
        <View style={localStyles.container}>
            <View style={localStyles.inputContainer}>
                <Icon name={'star'} size={24} color={'#ffffff'} style={localStyles.icon} />
                <View style={localStyles.editorContainer}>
                    <CustomTextInput3
                        placeholder={'Type to edit the skill'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        initialTextExtended={skill.extendedName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton onPress={openDV} />
                    <CommentWrapper
                        updateCurrentChanges={updateCurrentChanges}
                        projectId={projectId}
                        skillId={skill.id}
                        disabled={disableButtons}
                        inEditModal={true}
                        skillName={skill.name}
                        assistantId={skill.assistantId}
                    />
                    <PrivacyWrapper
                        object={skill}
                        objectType={FEED_SKILL_OBJECT_TYPE}
                        projectId={projectId}
                        setPrivacy={updatePrivacy}
                        disabled={disableButtons}
                    />
                    <SkillPointsWrapper
                        skill={skill}
                        projectId={projectId}
                        disabled={disableButtons}
                        updateSkillPoints={updatePoints}
                        points={skill.points}
                        inButtonsArea={true}
                        inEditModal={true}
                    />
                    <SkillMoreButton
                        projectId={projectId}
                        skill={skill}
                        buttonStyle={{ marginHorizontal: 4 }}
                        closeParent={closeModal}
                        disabled={disableButtons}
                        updateDescription={updateDescription}
                        updateCurrentChanges={updateCurrentChanges}
                        updateHighlight={updateHighlight}
                        refKey={skill.id}
                        isSkillsOwner={true}
                        inEditModal={true}
                        updateFollowState={updateFollowState}
                        updateCompletion={updateCompletion}
                    />
                </View>
                <SaveButton icon={skillHasValidChanges() ? 'save' : 'x'} onPress={updateCurrentChanges} />
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
    editorContainer: {
        marginTop: 2,
        marginBottom: 26,
        marginLeft: 28,
        minHeight: 38,
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
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
