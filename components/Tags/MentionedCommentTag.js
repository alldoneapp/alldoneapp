import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Backend from '../../utils/BackendBridge'
import TaskCommentsWrapper from './TaskCommentsWrapper'
import { getTagCommentsPrivacyData } from '../Feeds/Utils/HelperFunctions'
import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import useGetMessages from '../../hooks/Chats/useGetMessages'
import { getCustomStyle } from '../../utils/HelperFunctions'

export default function MentionedCommentTag({
    projectId,
    parentObjectId,
    inTextInput,
    parentType,
    inDetailView,
    linkForNoteTopic,
    assistantId,
}) {
    const comments = useGetMessages(false, true, projectId, parentObjectId, parentType)
    const commentsData = getTagCommentsPrivacyData(comments)
    const [userGettingKarmaId, setUserGettingKarmaId] = useState('')
    const [parentObjectName, setParentObjectName] = useState('')

    const getUserGettingKarmaId = parentObject => {
        if (parentObject) {
            setParentObjectName(parentObject.name)
            const { userId, recorderUserId } = parentObject
            if (userId) {
                setUserGettingKarmaId(userId)
            } else if (recorderUserId) {
                setUserGettingKarmaId(recorderUserId)
            }
        }
    }

    useEffect(() => {
        const watchId = Backend.getId()
        Backend.watchFeedObjectLastState(watchId, projectId, parentType, parentObjectId, getUserGettingKarmaId)
        return () => {
            Backend.unwatchFeedObjectLastState(watchId)
        }
    }, [])

    return (
        <View
            style={[
                inTextInput ? localStyles.globalinTextInput : localStyles.globalContainer,
                { backgroundColor: 'transparent' },
                getCustomStyle(inDetailView, null, false),
            ]}
        >
            {commentsData ? (
                <TaskCommentsWrapper
                    commentsData={commentsData}
                    projectId={projectId}
                    objectId={parentObjectId}
                    inTextInput={inTextInput}
                    objectType={parentType}
                    inDetailView={inDetailView}
                    userGettingKarmaId={userGettingKarmaId}
                    tagStyle={localStyles.tagStyle}
                    linkForNoteTopic={linkForNoteTopic}
                    objectName={parentObjectName}
                    assistantId={assistantId}
                />
            ) : (
                <View
                    accessibilityLabel={'social-text-block'}
                    style={[
                        inTextInput ? localStyles.inTextInput : localStyles.container,
                        { backgroundColor: colors.Grey300 },
                        getCustomStyle(inDetailView, null, false),
                    ]}
                >
                    <Icon
                        accessibilityLabel={'social-text-block'}
                        name="message-circle"
                        color={colors.Text03}
                        size={inDetailView ? 18 : 16}
                    />
                    <Text
                        accessibilityLabel={'social-text-block'}
                        numberOfLines={1}
                        style={[
                            localStyles.text,
                            inDetailView && { ...styles.title6 },
                            { color: colors.Text03 },
                            windowTagStyle(),
                        ]}
                    >
                        {commentsData ? commentsData.lastComment : `Loading preview .....`}
                    </Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    globalContainer: {
        borderRadius: 50,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    globalinTextInput: {
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        fontSize: 18,
        maxWidth: '100%',
    },
    tagStyle: {
        marginLeft: 0,
    },
    container: {
        borderRadius: 50,
        paddingLeft: 5.33,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    inTextInput: {
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        fontSize: 18,
        paddingLeft: 4,
        paddingRight: 8,
        maxWidth: '100%',
    },
    text: {
        ...styles.subtitle2,
        marginLeft: 5.33,
    },
})
