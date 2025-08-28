import React, { useState, useEffect } from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import Backend from '../../../../../utils/BackendBridge'
import { LINKED_OBJECT_TYPE_SKILL } from '../../../../../utils/LinkingHelper'

import { FEED_PUBLIC_FOR_ALL, FEED_SKILL_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import Icon from '../../../../Icon'

import styles, { colors } from '../../../../styles/global'
import BacklinksTag from '../../../../Tags/BacklinksTag'
import DescriptionTag from '../../../../Tags/DescriptionTag'
import PrivacyTag from '../../../../Tags/PrivacyTag'
import SocialText from '../../../../UIControls/SocialText/SocialText'
import CommentWrapperTag from '../CommentWrapperTag'
import SkillCompletionWrapper from '../SkillCompletionWrapper/SkillCompletionWrapper'
import SkillPointsWrapper from '../SkillPointsWrapper/SkillPointsWrapper'
import useActiveDragMode from '../useActiveDragMode'
import SkillProgressBar from './SkillProgressBar'
import { updateSkillDescription } from '../../../../../utils/backends/Skills/skillsFirestore'

export default function SkillPresentation({ projectId, skill, higherSkill, onPress, isDragging }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [backlinksTasksCount, setBacklinksTasksCount] = useState(0)
    const [backlinksNotesCount, setBacklinksNotesCount] = useState(0)
    const [backlinkTaskObject, setBacklinkTaskObject] = useState(null)
    const [backlinkNoteObject, setBacklinkNoteObject] = useState(null)
    const activeDragMode = useActiveDragMode(projectId)

    const { id: skillId, extendedName, points, userId } = skill
    const isSkillsOwner = !isAnonymous && userId === loggedUserId

    useEffect(() => {
        Backend.watchBacklinksCount(
            projectId,
            {
                type: LINKED_OBJECT_TYPE_SKILL,
                idsField: 'linkedParentSkillsIds',
                id: skillId,
            },
            (parentObjectType, parentsAmount, aloneParentObject) => {
                if (parentObjectType === 'tasks') {
                    setBacklinksTasksCount(parentsAmount)
                    setBacklinkTaskObject(aloneParentObject)
                } else if (parentObjectType === 'notes') {
                    setBacklinksNotesCount(parentsAmount)
                    setBacklinkNoteObject(aloneParentObject)
                }
            }
        )
    }, [])

    const getBacklinkData = () => {
        const backlinksCount = backlinksTasksCount + backlinksNotesCount
        const backlinkObject =
            backlinksCount === 1 ? (backlinksTasksCount === 1 ? backlinkTaskObject : backlinkNoteObject) : null

        return { backlinksCount, backlinkObject }
    }

    const updateDescription = description => {
        updateSkillDescription(projectId, skill, description)
    }

    const { backlinksCount, backlinkObject } = getBacklinkData()

    return (
        <View style={[localStyles.globalContainer, isDragging && localStyles.globalContainerDragged]}>
            <View style={[isDragging && localStyles.draggedContainer, activeDragMode && { paddingRight: 28 }]}>
                <View style={localStyles.container}>
                    <SkillProgressBar skill={skill} higherSkill={higherSkill} />
                    <View style={{ flexDirection: 'row' }}>
                        <TouchableOpacity onPress={onPress} style={localStyles.content}>
                            <View style={localStyles.descriptionContainer}>
                                <SocialText
                                    elementId={`social_text_$${skillId}`}
                                    style={[styles.body1, localStyles.descriptionText, { color: colors.Text01 }]}
                                    normalStyle={{ whiteSpace: 'normal' }}
                                    numberOfLines={1}
                                    wrapText={true}
                                    projectId={projectId}
                                    bgColor={'#ffffff'}
                                >
                                    {extendedName}
                                </SocialText>
                            </View>
                        </TouchableOpacity>
                        <View style={localStyles.tagsArea}>
                            <CommentWrapperTag
                                projectId={projectId}
                                skillId={skillId}
                                disabled={isAnonymous}
                                userGettingKarmaId={skill.userId}
                                skillName={skill.name}
                                commentsData={skill.commentsData}
                            />
                            {!skill.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && (
                                <PrivacyTag
                                    projectId={projectId}
                                    object={skill}
                                    objectType={FEED_SKILL_OBJECT_TYPE}
                                    style={{ marginLeft: 8 }}
                                    disabled={!isSkillsOwner}
                                />
                            )}
                            {backlinksCount > 0 && (
                                <BacklinksTag
                                    object={skill}
                                    objectId={skill.id}
                                    objectType={LINKED_OBJECT_TYPE_SKILL}
                                    projectId={projectId}
                                    style={{ marginLeft: 8 }}
                                    backlinksCount={backlinksCount}
                                    backlinkObject={backlinkObject}
                                    disabled={isAnonymous}
                                />
                            )}
                            {skill.description !== '' && (
                                <DescriptionTag
                                    projectId={projectId}
                                    object={skill}
                                    style={{ marginLeft: 8 }}
                                    objectType={FEED_SKILL_OBJECT_TYPE}
                                    disabled={!isSkillsOwner}
                                    updateDescription={updateDescription}
                                />
                            )}
                            {skill.completion > 0 && (
                                <SkillCompletionWrapper skill={skill} projectId={projectId} disabled={!isSkillsOwner} />
                            )}
                        </View>
                        <SkillPointsWrapper
                            skill={skill}
                            projectId={projectId}
                            disabled={!isSkillsOwner}
                            points={points}
                        />
                    </View>
                </View>
                {activeDragMode && (
                    <View style={[localStyles.sixDots, isDragging && localStyles.sixDotsDragging]}>
                        <Icon name="six-dots-vertical" size={24} color={colors.Text03} />
                    </View>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    globalContainer: {
        paddingVertical: 4,
        marginBottom: 12,
    },
    globalContainerDragged: {
        paddingVertical: 0,
    },
    draggedContainer: {
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: '#ffffff',
        boxShadow: `${0}px ${8}px ${16}px rgba(0,0,0,0.04), ${0}px ${4}px ${8}px rgba(0,0,0,0.04)`,
    },
    container: {
        minHeight: 38,
        borderRadius: 4,
        borderColor: colors.Grey300,
        borderWidth: 1,
    },
    content: {
        minHeight: 38,
        flexDirection: 'row',
        paddingVertical: 4,
        flex: 1,
        paddingLeft: 13,
        paddingRight: 8.7,
    },
    descriptionContainer: {
        paddingVertical: 1,
        flexGrow: 1,
        flex: 1,
    },
    descriptionText: {
        display: 'flex',
        alignItems: 'flex-start',
        maxHeight: 28,
    },
    tagsArea: {
        position: 'absolute',
        right: 64,
        bottom: 7,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    sixDots: {
        position: 'absolute',
        right: 0,
        top: 8,
    },
    sixDotsDragging: {
        top: 12,
    },
})
