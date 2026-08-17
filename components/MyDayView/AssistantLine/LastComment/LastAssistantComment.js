import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import UnreadCommentsBadge from './UnreadCommentsBadge'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import ProjectTagIndicator from './ProjectTagIndicator'
import { checkIfSelectedAllProjects } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    parseFeedComment,
    TEXT_ELEMENT,
    HASH_ELEMENT,
    URL_ELEMENT,
    MENTION_ELEMENT,
    EMAIL_ELEMENT,
    tryToextractPeopleForMention,
} from '../../../Feeds/Utils/HelperFunctions'
import HashTag from '../../../Tags/HashTag'
import LinkTag from '../../../Tags/LinkTag'
import MentionTag from '../../../Tags/MentionTag'
import EmailTag from '../../../Tags/EmailTag'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'

// The preview reserves a constant height so the assistant line (and everything below it) never
// reflows when the last comment changes length. The numbers below are the layout that was already
// the maximum before AT-2344: one clipped title line plus two clipped body lines.
export const PREVIEW_LINE_HEIGHT = 22 // styles.subtitle2 lineHeight
export const PREVIEW_TITLE_HEIGHT = PREVIEW_LINE_HEIGHT
export const PREVIEW_BODY_HEIGHT = PREVIEW_LINE_HEIGHT * 2
export const PREVIEW_VERTICAL_PADDING = 12
export const LAST_COMMENT_PREVIEW_HEIGHT = PREVIEW_TITLE_HEIGHT + PREVIEW_BODY_HEIGHT + PREVIEW_VERTICAL_PADDING * 2

export default function LastAssistantComment({
    projectId,
    commentText,
    onPress,
    objectName,
    isNew,
    unreadComments,
    isFollowedNotification,
    compact = false,
}) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const text = shrinkTagText(commentText.replace(/\s\s+/g, ' '), 500)
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    let linkCounter = 0
    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    if (compact) {
        return (
            <TouchableOpacity onPress={onPress} style={localStyles.compactContainer}>
                <Icon name={'message-circle'} color={colors.Text03} size={14} />
                <Text numberOfLines={1} style={localStyles.compactText}>
                    {text}
                </Text>
                {isNew && <UnreadCommentsBadge amount={unreadComments} followed={isFollowedNotification} />}
            </TouchableOpacity>
        )
    }

    const parsedElements = parseFeedComment(text)

    return (
        <TouchableOpacity onPress={onPress} style={[localStyles.container]}>
            <Icon name={'message-circle'} color={colors.Text03} size={16} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <View style={localStyles.titleRow}>
                    {!!objectName && (
                        <Text numberOfLines={2} style={localStyles.title}>
                            {objectName}
                        </Text>
                    )}
                </View>
                <View style={localStyles.parsedTextContainer}>
                    <View style={localStyles.parsedTextBody}>
                        {parsedElements.map((element, index) => {
                            const { type, text: elemText, link, email } = element
                            if (type === TEXT_ELEMENT) {
                                return elemText ? (
                                    <Text key={index} style={localStyles.text}>
                                        {elemText}{' '}
                                    </Text>
                                ) : null
                            } else if (type === HASH_ELEMENT) {
                                return (
                                    <HashTag
                                        key={index}
                                        projectId={projectId}
                                        text={elemText}
                                        useCommentTagStyle={true}
                                        tagStyle={localStyles.element}
                                    />
                                )
                            } else if (type === URL_ELEMENT) {
                                const people = tryToextractPeopleForMention(projectId, link)
                                if (people) {
                                    const { peopleName } = people
                                    return (
                                        <MentionTag
                                            key={index}
                                            text={peopleName}
                                            useCommentTagStyle={true}
                                            user={people}
                                            tagStyle={localStyles.element}
                                            projectId={projectId}
                                        />
                                    )
                                }
                                return (
                                    <LinkTag
                                        key={index}
                                        link={link}
                                        useCommentTagStyle={true}
                                        text={'Link ' + getLinkCounter()}
                                        tagStyle={localStyles.element}
                                    />
                                )
                            } else if (type === MENTION_ELEMENT) {
                                const { mention, user } = TasksHelper.getDataFromMention(elemText, projectId)
                                return (
                                    <MentionTag
                                        key={index}
                                        text={mention}
                                        useCommentTagStyle={true}
                                        user={user}
                                        tagStyle={localStyles.element}
                                        projectId={projectId}
                                    />
                                )
                            } else if (type === EMAIL_ELEMENT) {
                                return (
                                    <EmailTag
                                        key={index}
                                        email={email}
                                        useCommentTagStyle={true}
                                        address={email}
                                        tagStyle={localStyles.element}
                                    />
                                )
                            }
                            return (
                                <Text key={index} style={localStyles.text}>
                                    {elemText || link || email || ''}{' '}
                                </Text>
                            )
                        })}
                    </View>
                </View>
            </View>
            <ProjectTagIndicator projectId={projectId} />
            {isNew && <UnreadCommentsBadge amount={unreadComments} followed={isFollowedNotification} />}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        // Fixed (not min/max) so a short comment reserves exactly as much room as a long one.
        height: LAST_COMMENT_PREVIEW_HEIGHT,
        flexShrink: 0,
        // No overflow: 'hidden' here — the unread badge sits at top/right: -5, outside the card.
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: PREVIEW_VERTICAL_PADDING,
    },
    textContainer: {
        width: '100%',
        paddingRight: 20,
        justifyContent: 'flex-start',
    },
    titleRow: {
        // Reserved even when the chat has no title, so the body text never shifts upwards.
        height: PREVIEW_TITLE_HEIGHT,
        flexShrink: 0,
        overflow: 'hidden',
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text03,
        fontWeight: 'bold',
        overflow: 'hidden',
        maxHeight: PREVIEW_TITLE_HEIGHT,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    parsedTextContainer: {
        height: PREVIEW_BODY_HEIGHT,
        flexShrink: 0,
        overflow: 'hidden',
    },
    parsedTextBody: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    element: {
        marginRight: 4,
    },
    icon: {
        marginTop: 4,
        marginRight: 4,
    },
    compactContainer: {
        height: 24,
        maxHeight: 24,
        borderRadius: 12,
        paddingLeft: 6,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        overflow: 'hidden',
        width: 'auto',
        maxWidth: '100%',
    },
    compactText: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 6,
        flexShrink: 1,
    },
})
