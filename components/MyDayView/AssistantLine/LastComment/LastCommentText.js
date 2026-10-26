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

// Share the existing mention/link rendering across pending, saved and compact previews. Decode
// complete tokens: cutting serialized text first can split a space code, object id or avatar URL.
export default function LastCommentText({ projectId, commentText, compact = false, testID }) {
    const text = cleanTextMetaData(removeFormatTagsFromText(commentText || '').replace(/\s+/g, ' '), true, true)
    let linkCounter = 0
    const getLinkCounter = () => ++linkCounter
    // Keep the preview budget, extending to the next token boundary so metadata stays intact.
    const previewEnd = text.indexOf(' ', 500)
    const previewText = previewEnd === -1 ? text : `${text.substring(0, previewEnd)} ...`
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
