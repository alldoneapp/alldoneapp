import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { cleanTextMetaData, removeFormatTagsFromText } from '../../../../functions/Utils/parseTextUtils'
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

export const PREVIEW_TEXT_BUDGET = 500

/**
 * Cuts the decoded comment to the preview budget, always at a token boundary so mention metadata,
 * object ids and URLs stay intact.
 *
 * AT-2872 — `fromEnd` keeps the LAST part instead of the first. A long, growing comment such as a
 * VM/Claude status update starts with boilerplate ("Working with Claude…", subscription notice,
 * first command), so a head-first preview never showed what is actually happening right now.
 */
export const getPreviewText = (text, fromEnd = false) => {
    if (text.length <= PREVIEW_TEXT_BUDGET) return text
    if (!fromEnd) {
        const previewEnd = text.indexOf(' ', PREVIEW_TEXT_BUDGET)
        return previewEnd === -1 ? text : `${text.substring(0, previewEnd)} ...`
    }
    // Extend backwards to the previous token boundary, mirroring the head-first rule above.
    const previewStart = text.lastIndexOf(' ', text.length - PREVIEW_TEXT_BUDGET)
    return previewStart === -1 ? text : `... ${text.substring(previewStart + 1)}`
}

// Share the existing mention/link rendering across pending, saved and compact previews. Decode
// complete tokens: cutting serialized text first can split a space code, object id or avatar URL.
export default function LastCommentText({ projectId, commentText, compact = false, fromEnd = false, testID }) {
    const text = cleanTextMetaData(removeFormatTagsFromText(commentText || '').replace(/\s+/g, ' '), true, true)
    let linkCounter = 0
    const getLinkCounter = () => ++linkCounter
    const previewText = getPreviewText(text, fromEnd)
    const parsedElements = parseFeedComment(previewText)

    return (
        <View testID={testID} style={[localStyles.parsedTextBody, compact && localStyles.compactBody]}>
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
                            projectId={projectId}
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
    )
}

const localStyles = StyleSheet.create({
    parsedTextBody: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    compactBody: {
        flexWrap: 'nowrap',
        flexShrink: 1,
        overflow: 'hidden',
        marginLeft: 2,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    element: {
        marginRight: 4,
    },
})
