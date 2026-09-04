import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import ProjectTagIndicator from './ProjectTagIndicator'
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
import { PREVIEW_BODY_HEIGHT, PREVIEW_TITLE_HEIGHT, PREVIEW_VERTICAL_PADDING } from './lastCommentLayout'

/**
 * AT-2511 — one comment, laid out inside the Last comment card. Extracted from
 * `LastAssistantComment` so the card can render it TWICE: the comment rolling away and the one
 * rolling in are the same component with different props, which is what makes the ticker a
 * five-line animation rather than a DOM-snapshotting exercise.
 *
 * It carries the card's former padding, because the card itself no longer has any — the roll is
 * clipped by a viewport that fills the card's whole box, so the padding has to live on the rows
 * inside it. That is what keeps `ProjectTagIndicator`'s `right: 10 / top: 10` measured against the
 * same edges it always was.
 *
 * Purely presentational: no motion, no arrival state, no press handling. The card owns all three.
 */
const LastCommentRow = ({ projectId, commentText, objectName, compact = false }) => {
    const text = shrinkTagText((commentText || '').replace(/\s\s+/g, ' '), 500)

    if (compact) {
        return (
            <>
                <Icon name={'message-circle'} color={colors.Text03} size={14} />
                <Text numberOfLines={1} style={localStyles.compactText}>
                    {text}
                </Text>
            </>
        )
    }

    let linkCounter = 0
    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    const parsedElements = parseFeedComment(text)

    return (
        <>
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
        </>
    )
}

export default LastCommentRow

// The row's own box, applied by the card to each rolling layer. Exported rather than duplicated so
// the outgoing and incoming layers can never be laid out differently — a difference of a single
// pixel of padding would show as the text jogging sideways as the roll lands.
export const rowStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: PREVIEW_VERTICAL_PADDING,
    },
    compactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 6,
        paddingRight: 10,
    },
})

const localStyles = StyleSheet.create({
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
    compactText: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 6,
        flexShrink: 1,
    },
})
