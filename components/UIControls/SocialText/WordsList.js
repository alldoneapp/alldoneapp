import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { colors } from '../../styles/global'
import LinkTag from '../../Tags/LinkTag'
import {
    ATTACHMENT_ELEMENT,
    EMAIL_ELEMENT,
    GENERIC_ELEMENT,
    HASH_ELEMENT,
    IMAGE_ELEMENT,
    KARMA_ELEMENT,
    MENTION_ELEMENT,
    tryToextractPeopleForMention,
    URL_ELEMENT,
    VIDEO_ELEMENT,
} from '../../Feeds/Utils/HelperFunctions'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import MentionedCommentTag from '../../Tags/MentionedCommentTag'
import HashTag from '../../Tags/HashTag'
import MentionTag from '../../Tags/MentionTag'
import EmailTag from '../../Tags/EmailTag'
import FileDownloadableTag from '../../Tags/FileDownloadableTag'
import KarmaTag from '../../Tags/KarmaTag'
import { getKarmaData } from '../../Feeds/CommentsTextInput/textInputHelper'
import { getAttachmentData, getImageData, getVideoData } from '../../../functions/Utils/parseTextUtils'

export default function WordsList({
    numberOfLines,
    wrapText,
    hasLinkBack,
    linkStyle,
    task,
    inTaskDetailedView,
    emailStyle,
    hashtagStyle,
    mentionStyle,
    textStyle,
    normalStyle,
    projectId,
    inFeedComment,
    wordList,
}) {
    let emails = 0
    let links = 0

    return (
        <>
            {wordList.map((word, i) => {
                if (word.type === GENERIC_ELEMENT && task) {
                    const { parentObjectId, parentType, assistantId } = task.genericData
                    return (
                        <MentionedCommentTag
                            key={i}
                            projectId={projectId}
                            parentObjectId={parentObjectId}
                            parentType={parentType}
                            inDetailView={inTaskDetailedView}
                            linkForNoteTopic={wordList.find(e => e.link)?.link}
                            assistantId={assistantId}
                        />
                    )
                } else if (word.type === KARMA_ELEMENT) {
                    const { userId } = getKarmaData(word.text)
                    return (
                        <KarmaTag
                            key={i}
                            userId={userId}
                            style={[localStyles.marginRight, wrapText && localStyles.wrappedText]}
                        />
                    )
                } else if (word.type === ATTACHMENT_ELEMENT) {
                    const { uri, attachmentText } = getAttachmentData(word.text)
                    return (
                        <FileDownloadableTag
                            projectId={projectId}
                            key={i}
                            text={attachmentText}
                            uri={uri}
                            style={[localStyles.marginRight, wrapText && localStyles.wrappedText]}
                            inDetaliedView={inTaskDetailedView}
                        />
                    )
                } else if (word.type === IMAGE_ELEMENT) {
                    const { uri, imageText } = getImageData(word.text)
                    return (
                        <FileDownloadableTag
                            projectId={projectId}
                            key={i}
                            text={imageText}
                            uri={uri}
                            style={[localStyles.marginRight, wrapText && localStyles.wrappedText]}
                            inDetaliedView={inTaskDetailedView}
                        />
                    )
                } else if (word.type === VIDEO_ELEMENT) {
                    const { uri, videoText } = getVideoData(word.text)
                    return (
                        <FileDownloadableTag
                            projectId={projectId}
                            key={i}
                            text={videoText}
                            uri={uri}
                            style={[localStyles.marginRight, wrapText && localStyles.wrappedText]}
                            inDetaliedView={inTaskDetailedView}
                        />
                    )
                } else if (word.type === URL_ELEMENT) {
                    const { link } = word
                    const people = tryToextractPeopleForMention(projectId, link)
                    if (people) {
                        const { peopleName } = people
                        return (
                            <TouchableOpacity key={i} style={{ flexDirection: 'row', marginRight: 4.3 }}>
                                <MentionTag
                                    style={mentionStyle}
                                    tagStyle={wrapText && localStyles.wrappedText}
                                    text={peopleName}
                                    inTaskDV={inTaskDetailedView}
                                    user={people}
                                    projectId={projectId}
                                    useCommentTagStyle={inFeedComment}
                                />
                            </TouchableOpacity>
                        )
                    }
                    links++
                    return (
                        <View key={`${i}_${hasLinkBack ? task.linkBack : word.link}`} style={localStyles.centeredRow}>
                            {hasLinkBack ? (
                                <LinkTag
                                    link={`${window.location.origin}${task.linkBack}`}
                                    text={'Link ' + links}
                                    style={linkStyle}
                                    tagStyle={wrapText && localStyles.wrappedText}
                                    inTaskDV={inTaskDetailedView}
                                    useCommentTagStyle={inFeedComment}
                                    expandFullTitle={!!task.genericData}
                                    taskId={task.id}
                                    projectId={projectId}
                                />
                            ) : (
                                <LinkTag
                                    link={word.link}
                                    text={'Link ' + links}
                                    style={linkStyle}
                                    tagStyle={wrapText && localStyles.wrappedText}
                                    inTaskDV={inTaskDetailedView}
                                    useCommentTagStyle={inFeedComment}
                                    expandFullTitle={task && !!task.genericData}
                                    taskId={task?.id}
                                    projectId={projectId}
                                />
                            )}
                        </View>
                    )
                } else if (word.type === EMAIL_ELEMENT) {
                    emails++
                    return (
                        <TouchableOpacity key={`${i}_${word.email}`} style={localStyles.centeredRow}>
                            <EmailTag
                                style={emailStyle}
                                tagStyle={wrapText && localStyles.wrappedText}
                                address={word.email}
                                text={'Mail ' + emails}
                                inTaskDV={inTaskDetailedView}
                                useCommentTagStyle={inFeedComment}
                            />
                        </TouchableOpacity>
                    )
                } else if (word.type === HASH_ELEMENT) {
                    return (
                        <TouchableOpacity
                            key={`${i}_${word.text.trim()}`}
                            style={{ flexDirection: 'row', marginRight: 4.3 }}
                        >
                            <HashTag
                                projectId={projectId}
                                style={hashtagStyle}
                                tagStyle={wrapText && localStyles.wrappedText}
                                text={word.text.trim()}
                                inTaskDV={inTaskDetailedView}
                                useCommentTagStyle={inFeedComment}
                            />
                        </TouchableOpacity>
                    )
                } else if (word.type === MENTION_ELEMENT) {
                    let { mention, user } = TasksHelper.getDataFromMention(word.text, projectId)
                    return (
                        <TouchableOpacity key={i} style={{ flexDirection: 'row', marginRight: 4.3 }}>
                            <MentionTag
                                style={mentionStyle}
                                tagStyle={wrapText && localStyles.wrappedText}
                                text={mention}
                                inTaskDV={inTaskDetailedView}
                                user={user}
                                projectId={projectId}
                                useCommentTagStyle={inFeedComment}
                            />
                        </TouchableOpacity>
                    )
                } else if (word.text.length > 0) {
                    const wordList = word.text.trim().split(' ')

                    return wordList.map((word, j) => (
                        <Text
                            key={`${i}${j}`}
                            style={[localStyles.text, textStyle, normalStyle, wrapText && localStyles.wrappedText]}
                            numberOfLines={numberOfLines}
                        >
                            {word}
                            {j === wordList.length - 1 ? '' : ' '}
                        </Text>
                    ))
                }
            })}
        </>
    )
}

const localStyles = StyleSheet.create({
    links: {
        color: colors.Primary100,
        backgroundColor: '#D6EBFF',
        paddingRight: 8,
        paddingLeft: 2,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    centeredRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 4.3,
    },
    text: {
        whiteSpace: 'pre-wrap',
        marginRight: 4.3,
    },
    wrappedText: {
        marginTop: 3,
        marginBottom: 3,
    },
    marginRight: {
        marginRight: 4.3,
    },
})
