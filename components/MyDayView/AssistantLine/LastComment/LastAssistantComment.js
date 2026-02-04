import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import ReddBubble from './ReddBubble'
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

export default function LastAssistantComment({ projectId, commentText, onPress, objectName, isNew }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const text = shrinkTagText(commentText.replace(/\s\s+/g, ' '), 500)
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    let linkCounter = 0
    const getLinkCounter = () => {
        linkCounter++
        return linkCounter
    }

    const parsedElements = parseFeedComment(text)

    return (
        <TouchableOpacity onPress={onPress} style={[localStyles.container]}>
            <Icon name={'message-circle'} color={colors.Text03} size={16} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                {!!objectName && (
                    <Text numberOfLines={2} style={localStyles.title}>
                        {objectName}
                    </Text>
                )}
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
            {isNew && <ReddBubble />}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 80,
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: 12,
    },
    textContainer: {
        width: '100%',
        paddingRight: 20,
        justifyContent: 'flex-start',
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text03,
        fontWeight: 'bold',
        overflow: 'hidden',
        maxHeight: 22,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    parsedTextContainer: {
        maxHeight: 44,
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
})
