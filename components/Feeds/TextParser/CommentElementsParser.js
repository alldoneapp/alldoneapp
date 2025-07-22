import React, { useRef, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
    ATTACHMENT_ELEMENT,
    EMAIL_ELEMENT,
    HASH_ELEMENT,
    IMAGE_ELEMENT,
    KARMA_ELEMENT,
    MENTION_ELEMENT,
    parseBreakLineFeedComment,
    TEXT_ELEMENT,
    tryToextractPeopleForMention,
    URL_ELEMENT,
    VIDEO_ELEMENT,
} from '../Utils/HelperFunctions'
import HashTag from '../../Tags/HashTag'
import MentionTag from '../../Tags/MentionTag'
import EmailTag from '../../Tags/EmailTag'
import LinkTag from '../../Tags/LinkTag'
import { getPopoverWidth } from '../../../utils/HelperFunctions'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { getKarmaData } from '../CommentsTextInput/textInputHelper'
import FileDownloadableTag from '../../Tags/FileDownloadableTag'
import KarmaTag from '../../Tags/KarmaTag'
import CustomImage from '../CommentsTextInput/autoformat/tags/CustomImage'
import MediaPlayer from '../../UIComponents/MediaPlayer'
import { divideBoldText } from '../../ChatsView/ChatDV/EditorView/codeParserFunctions'
import { getAttachmentData, getImageData, getVideoData } from '../../../functions/Utils/parseTextUtils'

export default function CommentElementsParser({
    comment,
    containerStyle,
    entryStyle,
    projectId,
    elementSpace,
    inChat,
    inDetaliedView,
}) {
    const [parsedComment, setParsedComment] = useState([])

    const containerWidth = useRef(getPopoverWidth() - 48)

    let linkCounter = 0
    let emailCounter = 0

    const onLayout = ({ nativeEvent }) => {
        if (inChat) {
            containerWidth.current = nativeEvent.layout.width - 16
        }
    }

    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    useEffect(() => {
        const boldText = divideBoldText(comment)

        const elementsEntries = []
        boldText.forEach(data => {
            const { text, type } = data
            const previousLine = elementsEntries[elementsEntries.length - 1]

            if (
                previousLine &&
                previousLine[previousLine.length - 1].text[previousLine[previousLine.length - 1].text.length - 1] !==
                    '\n' &&
                previousLine[previousLine.length - 1].text[previousLine[previousLine.length - 1].text.length - 1] !==
                    '\r'
            ) {
                elementsEntries[elementsEntries.length - 1] = elementsEntries[elementsEntries.length - 1].concat(
                    ...parseBreakLineFeedComment(text, type === 'bold')
                )
            } else {
                elementsEntries.push(...parseBreakLineFeedComment(text, type === 'bold'))
            }
        })

        const parsedElementsEntries = inChat ? [[]] : elementsEntries

        if (inChat) {
            let lineIndex = 0
            elementsEntries.forEach(elements => {
                const newElements = []
                elements.forEach(element => {
                    const { type, text, link, email, bold } = element
                    if (text || link || email) {
                        if (type === TEXT_ELEMENT) {
                            const words = text.split(/\r?\n|\r|\n/g)
                            words.forEach((word, index) => {
                                if (word[index] === '' && index === 0) {
                                    parsedElementsEntries.push([])
                                    lineIndex++
                                } else {
                                    if (word) {
                                        parsedElementsEntries[lineIndex].push({ type, text: word, link, email, bold })
                                    }
                                    if (index < words.length - 1) {
                                        parsedElementsEntries.push([])
                                        lineIndex++
                                    }
                                }
                            })
                        } else {
                            newElements.push(element)
                            parsedElementsEntries[lineIndex].push(element)
                        }
                    }
                })
            })
        }
        setParsedComment(parsedElementsEntries)
    }, [comment])

    return (
        <View style={containerStyle} onLayout={onLayout}>
            {parsedComment.map((elements, linesIndex) => (
                <View key={linesIndex} style={[localStyles.body, elements.length === 0 ? { marginTop: 8 } : null]}>
                    {elements.map((element, elementIndex) => {
                        const { type, text, link, email, bold } = element
                        if (type === TEXT_ELEMENT) {
                            return text ? (
                                <Text
                                    key={elementIndex}
                                    style={[
                                        localStyles.entry,
                                        entryStyle,
                                        elementSpace ? elementSpace : localStyles.element,
                                        bold && { fontWeight: 'bold' },
                                    ]}
                                >
                                    {text}
                                </Text>
                            ) : null
                        } else if (type === KARMA_ELEMENT) {
                            const { userId } = getKarmaData(text)
                            return (
                                <KarmaTag
                                    userId={userId}
                                    style={elementSpace ? elementSpace : localStyles.element}
                                    useCommentTagStyle={inChat}
                                    viewProjectId={projectId}
                                />
                            )
                        } else if (type === ATTACHMENT_ELEMENT) {
                            const { uri, attachmentText } = getAttachmentData(text)
                            return (
                                <FileDownloadableTag
                                    projectId={projectId}
                                    text={attachmentText}
                                    uri={uri}
                                    style={elementSpace ? elementSpace : localStyles.element}
                                    inDetaliedView={inDetaliedView}
                                />
                            )
                        } else if (type === IMAGE_ELEMENT) {
                            const { uri, resizedUri } = getImageData(text)
                            return (
                                <CustomImage
                                    projectId={projectId}
                                    uri={uri}
                                    resizedUri={resizedUri}
                                    maxWidth={containerWidth.current}
                                />
                            )
                        } else if (type === VIDEO_ELEMENT) {
                            const { uri } = getVideoData(text)
                            return (
                                <View style={localStyles.videoTag}>
                                    <MediaPlayer projectId={projectId} src={uri} />
                                </View>
                            )
                        } else if (type === HASH_ELEMENT) {
                            return (
                                <HashTag
                                    projectId={projectId}
                                    key={elementIndex}
                                    style={inChat ? localStyles.element : null}
                                    text={text}
                                    useCommentTagStyle={inChat}
                                    tagStyle={elementSpace ? elementSpace : localStyles.element}
                                    inTaskDV={inDetaliedView}
                                />
                            )
                        } else if (type === MENTION_ELEMENT) {
                            let { mention, user } = TasksHelper.getDataFromMention(text, projectId)
                            return (
                                <MentionTag
                                    key={elementIndex}
                                    style={inChat ? localStyles.element : null}
                                    text={mention}
                                    useCommentTagStyle={inChat}
                                    user={user}
                                    tagStyle={elementSpace ? elementSpace : localStyles.element}
                                    projectId={projectId}
                                    inTaskDV={inDetaliedView}
                                />
                            )
                        } else if (type === EMAIL_ELEMENT) {
                            return (
                                <EmailTag
                                    key={elementIndex}
                                    email={email}
                                    useCommentTagStyle={inChat}
                                    address={email}
                                    tagStyle={elementSpace ? elementSpace : localStyles.element}
                                    inTaskDV={inDetaliedView}
                                />
                            )
                        } else if (type === URL_ELEMENT) {
                            const people = tryToextractPeopleForMention(projectId, link)
                            if (people) {
                                const { peopleName } = people
                                return (
                                    <MentionTag
                                        key={elementIndex}
                                        style={inChat ? localStyles.element : null}
                                        text={peopleName}
                                        useCommentTagStyle={inChat}
                                        user={people}
                                        tagStyle={elementSpace ? elementSpace : localStyles.element}
                                        projectId={projectId}
                                        inTaskDV={inDetaliedView}
                                    />
                                )
                            }
                            return (
                                <LinkTag
                                    inTaskDV={inDetaliedView}
                                    key={elementIndex}
                                    link={link}
                                    useCommentTagStyle={inChat}
                                    text={'Link ' + getLinkCounter()}
                                    tagStyle={elementSpace ? elementSpace : localStyles.element}
                                />
                            )
                        }
                    })}
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    body: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignContent: 'center',
    },
    element: {
        marginRight: 6,
    },
    entry: {
        overflow: 'hidden',
    },
    tag: {
        height: 20,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    videoTag: {
        flex: 1,
        width: '100%',
        overflow: 'hidden',
    },
})
