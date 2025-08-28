import React, { useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import {
    ATTACHMENT_ELEMENT,
    EMAIL_ELEMENT,
    GENERIC_ELEMENT,
    HASH_ELEMENT,
    IMAGE_ELEMENT,
    MENTION_ELEMENT,
    parseFeedComment,
    TEXT_ELEMENT,
    tryToextractPeopleForMention,
    URL_ELEMENT,
    VIDEO_ELEMENT,
    KARMA_ELEMENT,
} from '../Utils/HelperFunctions'
import styles, { em2px } from '../../styles/global'
import HashTag from '../../Tags/HashTag'
import MentionTag from '../../Tags/MentionTag'
import EmailTag from '../../Tags/EmailTag'
import LinkTag from '../../Tags/LinkTag'
import LinkBack from '../../Tags/LinkBack'
import MediaTag from '../../Tags/MediaTag'
import KarmaTag from '../../Tags/KarmaTag'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { getKarmaData } from '../CommentsTextInput/textInputHelper'
import FileDownloadableTag from '../../Tags/FileDownloadableTag'
import CustomImage from '../CommentsTextInput/autoformat/tags/CustomImage'
import MediaPlayer from '../../UIComponents/MediaPlayer'
import { getPopoverWidth } from '../../../utils/HelperFunctions'
import { getAttachmentData, getImageData, getVideoData } from '../../../functions/Utils/parseTextUtils'

export default function ObjectHeaderParser({
    text,
    linkBack,
    containerExternalStyle,
    entryExternalStyle,
    genericLink,
    genericLinkToComments,
    projectId,
    onPress,
    inDetaliedView,
    inMentionModal,
    inMentionModalDescription,
    dotsStyle,
    disebledTags,
    maxHeight,
    shortTags,
}) {
    const [showDots, setShowDots] = useState(false)
    const containerWidth = useRef(getPopoverWidth())
    const elements = parseFeedComment(text.replace(/  +/g, ' '), !!genericLink, false)
    let linkCounter = 0

    const onLayout = ({ nativeEvent }) => {
        const { width } = nativeEvent.layout
        containerWidth.current = width
    }

    const onLayoutInnerContainer = ({ nativeEvent }) => {
        const { height } = nativeEvent.layout
        setShowDots(height > maxHeight)
    }

    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    const renderedElements = elements.map((element, index) => {
        const { type, text, link, email } = element
        if (type === GENERIC_ELEMENT) {
            return (
                <LinkBack
                    style={inMentionModalDescription ? localStyles.textMentionModalDesc : null}
                    link={genericLink}
                    text={text}
                    toComments={genericLinkToComments}
                    inTaskDetailedView={inDetaliedView}
                    disabled={disebledTags}
                    tagStyle={[
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                    ]}
                    iconSize={inMentionModalDescription && 10}
                />
            )
        } else if (type === KARMA_ELEMENT) {
            const { userId } = getKarmaData(text)
            return (
                <KarmaTag
                    userId={userId}
                    style={[
                        localStyles.element,
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                    ]}
                    useCommentTagStyle={inMentionModal}
                    iconSize={inMentionModalDescription && 10}
                    imageStyle={{ width: 10, height: 10 }}
                    textStyle={inMentionModalDescription && localStyles.textMentionModalDesc}
                />
            )
        } else if (type === ATTACHMENT_ELEMENT) {
            const { uri, attachmentText } = getAttachmentData(text)
            return (
                <View
                    style={[
                        localStyles.element,
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                    ]}
                >
                    <FileDownloadableTag
                        projectId={projectId}
                        text={attachmentText}
                        uri={uri}
                        inDetaliedView={inDetaliedView}
                        disabled={disebledTags}
                        useCommentTagStyle={inMentionModal}
                        iconSize={inMentionModalDescription && 10}
                        textStyle={inMentionModalDescription && localStyles.textMentionModalDesc}
                        style={[
                            inMentionModalDescription && localStyles.elementMentionModalDesc,
                            inMentionModal && localStyles.elementMentionModal,
                        ]}
                    />
                </View>
            )
        } else if (type === IMAGE_ELEMENT) {
            const { uri, resizedUri, imageText } = getImageData(text)
            if (inMentionModal) {
                return (
                    <View
                        style={[
                            localStyles.element,
                            inMentionModalDescription && localStyles.elementMentionModalDesc,
                            inMentionModal && localStyles.elementMentionModal,
                        ]}
                    >
                        <MediaTag
                            text={imageText}
                            ico="image"
                            useCommentTagStyle={inMentionModal}
                            iconSize={inMentionModalDescription && 10}
                            textStyle={inMentionModalDescription && localStyles.textMentionModalDesc}
                            style={[
                                inMentionModalDescription && localStyles.elementMentionModalDesc,
                                inMentionModal && localStyles.elementMentionModal,
                            ]}
                        />
                    </View>
                )
            }
            return (
                <CustomImage
                    projectId={projectId}
                    uri={uri}
                    resizedUri={resizedUri}
                    maxWidth={containerWidth.current}
                />
            )
        } else if (type === VIDEO_ELEMENT) {
            const { uri, videoText } = getVideoData(text)
            if (inMentionModal) {
                return (
                    <View
                        style={[
                            localStyles.element,
                            inMentionModalDescription && localStyles.elementMentionModalDesc,
                            inMentionModal && localStyles.elementMentionModal,
                        ]}
                    >
                        <MediaTag
                            text={videoText}
                            ico="video"
                            useCommentTagStyle={inMentionModal}
                            iconSize={inMentionModalDescription && 10}
                            textStyle={inMentionModalDescription && localStyles.textMentionModalDesc}
                            style={[
                                inMentionModalDescription && localStyles.elementMentionModalDesc,
                                inMentionModal && localStyles.elementMentionModal,
                            ]}
                        />
                    </View>
                )
            }
            return <MediaPlayer projectId={projectId} src={uri} />
        } else if (type === TEXT_ELEMENT) {
            const extraSpace = elements[index - 1] && elements[index - 1].type === URL_ELEMENT ? ' ' : ''
            return (
                <Text key={index} style={[localStyles.entry, localStyles.element, entryExternalStyle]}>
                    {extraSpace + text}
                </Text>
            )
        } else if (type === HASH_ELEMENT) {
            return (
                <HashTag
                    projectId={projectId}
                    key={index}
                    text={text}
                    tagStyle={[
                        localStyles.element,
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                    ]}
                    tagContainerStyle={
                        inMentionModalDescription && [
                            localStyles.elementMentionModalDesc,
                            { paddingLeft: 1, paddingRight: 4 },
                        ]
                    }
                    inTaskDV={inDetaliedView}
                    disabled={disebledTags}
                    useCommentTagStyle={inMentionModal}
                    iconSize={inMentionModalDescription && 10}
                    textStyle={inMentionModalDescription && localStyles.textMentionModalDescHash}
                />
            )
        } else if (type === MENTION_ELEMENT) {
            let { mention, user } = TasksHelper.getDataFromMention(text, projectId)
            return (
                <MentionTag
                    key={index}
                    text={mention}
                    user={user}
                    tagStyle={[
                        localStyles.element,
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                    ]}
                    projectId={projectId}
                    inTaskDV={inDetaliedView}
                    disabled={disebledTags}
                    useCommentTagStyle={inMentionModal}
                    avatarSize={inMentionModalDescription && 10}
                    textStyle={inMentionModalDescription && localStyles.textMentionModalDesc}
                    tagContainerStyle={
                        inMentionModalDescription && [
                            localStyles.elementMentionModalDesc,
                            { paddingLeft: 1, paddingRight: 4 },
                        ]
                    }
                />
            )
        } else if (type === EMAIL_ELEMENT) {
            return (
                <EmailTag
                    key={index}
                    email={email}
                    address={email}
                    tagStyle={[
                        localStyles.element,
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                    ]}
                    inTaskDV={inDetaliedView}
                    disabled={disebledTags}
                    useCommentTagStyle={inMentionModal}
                    iconSize={inMentionModalDescription && 10}
                    style={
                        inMentionModalDescription && {
                            fontFamily: 'Roboto-Regular',
                            fontSize: 9,
                            lineHeight: 10,
                            letterSpacing: 0.5,
                        }
                    }
                    tagContainerStyle={
                        inMentionModalDescription && [
                            localStyles.elementMentionModalDesc,
                            { paddingLeft: 1, paddingRight: 4 },
                        ]
                    }
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
                        user={people}
                        tagStyle={[
                            localStyles.element,
                            inMentionModalDescription && localStyles.elementMentionModalDesc,
                            inMentionModal && localStyles.elementMentionModal,
                        ]}
                        projectId={projectId}
                        inTaskDV={inDetaliedView}
                        disabled={disebledTags}
                        useCommentTagStyle={inMentionModal}
                        avatarSize={inMentionModalDescription && 10}
                        textStyle={inMentionModalDescription && localStyles.textMentionModalDesc}
                    />
                )
            }
            return (
                <LinkTag
                    key={index}
                    inTaskDV={inDetaliedView}
                    link={link}
                    text={'Link ' + getLinkCounter()}
                    tagStyle={[
                        localStyles.element,
                        inMentionModalDescription && localStyles.elementMentionModalDesc,
                        inMentionModal && localStyles.elementMentionModal,
                        { alignItems: 'baseline' },
                    ]}
                    disabled={disebledTags}
                    shortTags={shortTags}
                    useCommentTagStyle={inMentionModal}
                    iconSize={inMentionModalDescription && 10}
                    aTagStyle={
                        inMentionModalDescription && {
                            fontSize: 9,
                            lineHeight: 10,
                            letterSpacing: 0.5,
                            minHeight: 10,
                            height: 10,
                        }
                    }
                    style={
                        inMentionModalDescription && {
                            fontSize: 9,
                            lineHeight: 10,
                            letterSpacing: 0.5,
                        }
                    }
                    tagContainerStyle={
                        inMentionModalDescription && [
                            localStyles.elementMentionModalDesc,
                            { paddingLeft: 1, paddingRight: 4 },
                        ]
                    }
                    avatarSize={inMentionModalDescription && 10}
                />
            )
        }
    })

    return onPress ? (
        <TouchableOpacity onPress={onPress} style={[localStyles.body, containerExternalStyle]} onLayout={onLayout}>
            <View style={localStyles.innerContainer}>
                {linkBack && <LinkBack link={linkBack} text={'Link'} disabled={disebledTags} />}
                {renderedElements}
            </View>
        </TouchableOpacity>
    ) : (
        <View style={[localStyles.body, containerExternalStyle]} onLayout={onLayout}>
            <View style={localStyles.innerContainer} onLayout={maxHeight != undefined ? onLayoutInnerContainer : null}>
                {linkBack && <LinkBack link={linkBack} text={'Link'} disabled={disebledTags} />}
                {renderedElements}
            </View>
            {showDots ? <Text style={[localStyles.dots, entryExternalStyle, dotsStyle]}>...</Text> : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    body: {
        marginLeft: 12,
        flex: 1,
    },
    innerContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    dots: {
        ...styles.body1,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
    element: {
        marginRight: 4,
    },
    elementMentionModal: {
        height: 24,
        justifyContent: 'center',
    },
    entry: {
        ...styles.body1,
        overflow: 'hidden',
    },
    tag: {
        height: 24,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    elementMentionModalDesc: {
        minHeight: 12,
        height: 12,
        justifyContent: 'center',
    },
    textMentionModalDesc: {
        fontFamily: 'Roboto-Medium',
        fontSize: 9,
        lineHeight: 10,
        letterSpacing: 0.5,
    },
    textMentionModalDescHash: {
        fontFamily: 'Roboto-Medium',
        fontSize: 9,
        lineHeight: 10,
        letterSpacing: 0.5,
        marginLeft: 2,
    },
})
