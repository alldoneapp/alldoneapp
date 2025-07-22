import React, { useEffect, useState } from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import SocialText from '../../UIControls/SocialText/SocialText'
import AssistantAvatar from './AssistantAvatar'
import BacklinksTag from '../../Tags/BacklinksTag'
import { LINKED_OBJECT_TYPE_ASSISTANT } from '../../../utils/LinkingHelper'
import Backend from '../../../utils/BackendBridge'
import ObjectNoteTag from '../../Tags/ObjectNoteTag'
import CommentWrapperTag from './CommentWrapperTag'
import { isGlobalAssistant } from './assistantsHelper'

export default function AssistantPresentation({ projectId, assistant, onAssistantClick }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [backlinksTasksCount, setBacklinksTasksCount] = useState(0)
    const [backlinksNotesCount, setBacklinksNotesCount] = useState(0)
    const [backlinkTaskObject, setBacklinkTaskObject] = useState(null)
    const [backlinkNoteObject, setBacklinkNoteObject] = useState(null)

    const { uid: assistantId, displayName, photoURL50 } = assistant

    useEffect(() => {
        Backend.watchBacklinksCount(
            projectId,
            {
                type: LINKED_OBJECT_TYPE_ASSISTANT,
                idsField: 'linkedParentAssistantIds',
                id: assistant.uid,
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

    const { backlinksCount, backlinkObject } = getBacklinkData()

    const isGlobal = isGlobalAssistant(assistant.uid)

    return (
        <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity
                onPress={() => {
                    onAssistantClick(assistant)
                }}
                style={localStyles.content}
            >
                <View style={{ position: 'absolute' }}>
                    <AssistantAvatar assistantId={assistantId} photoURL={photoURL50} size={40} />
                </View>
                <View style={localStyles.descriptionContainer}>
                    <SocialText
                        elementId={`social_text_$${assistantId}`}
                        style={[styles.body1, localStyles.descriptionText, { color: colors.Text01 }]}
                        normalStyle={{ whiteSpace: 'normal' }}
                        numberOfLines={1}
                        wrapText={true}
                        bgColor={'#ffffff'}
                    >
                        {displayName}
                    </SocialText>
                </View>
            </TouchableOpacity>
            <View style={localStyles.tagsArea}>
                {!isGlobal && (
                    <CommentWrapperTag
                        projectId={projectId}
                        disabled={isAnonymous}
                        userGettingKarmaId={assistant.creatorId}
                        assistantName={assistant.displayName}
                        assistantId={assistantId}
                        commentsData={assistant.commentsData}
                    />
                )}
                {assistant.noteIdsByProject[projectId] && (
                    <ObjectNoteTag
                        objectId={assistant.uid}
                        objectType="assistants"
                        projectId={projectId}
                        style={{ marginLeft: 8 }}
                    />
                )}
                {backlinksCount > 0 && (
                    <BacklinksTag
                        object={assistant}
                        objectId={assistant.uid}
                        objectType={LINKED_OBJECT_TYPE_ASSISTANT}
                        projectId={projectId}
                        style={{ marginLeft: 8 }}
                        backlinksCount={backlinksCount}
                        backlinkObject={backlinkObject}
                        disabled={isAnonymous}
                    />
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    content: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    descriptionContainer: {
        paddingVertical: 1,
        flexGrow: 1,
        flex: 1,
        flexDirection: 'row',
        marginLeft: 44,
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
})
