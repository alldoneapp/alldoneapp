import React from 'react'
import { StyleSheet, Text, View, Image } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'

export default function KarmaTag({ style, userId, useCommentTagStyle, viewProjectId, iconSize, textStyle, imageStyle }) {
    const projectId = viewProjectId ? viewProjectId : useSelector(state => state.quillEditorProjectId)
    const user = TasksHelper.getUserInProject(projectId, userId)
    const photoURL = user ? user.photoURL : ''

    const getAvatarStyle = () => {
        return useCommentTagStyle ? localStyles.smallMentionImage : localStyles.mentionImage
    }

    const svgDimentions = useCommentTagStyle ? { width: 16, height: 16 } : { width: 20, height: 20 }

    return (
        <View style={[localStyles.tag, useCommentTagStyle && { minHeight: 20, height: 20 }, style]}>
            <Icon name="thumbs-up" size={iconSize || useCommentTagStyle ? 14 : 16} color={colors.Primary100} />
            <Text style={[localStyles.text, useCommentTagStyle && localStyles.commentText, textStyle]} numberOfLines={1}>
                Karma
            </Text>
            {photoURL ? (
                <Image source={{ uri: photoURL }} style={[getAvatarStyle(), imageStyle]} />
            ) : (
                <View style={[localStyles.svg, getAvatarStyle(), imageStyle]}>
                    <SVGGenericUser width={svgDimentions.width} height={svgDimentions.height} svgid={userId} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        ...styles.subtitle2,
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.UtilityBlue112,
        borderRadius: 50,
        fontSize: 18,
        paddingLeft: 4,
        paddingRight: 2,
        height: 24,
        maxWidth: '100%',
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        color: colors.Primary100,
        marginLeft: 6,
        marginRight: 10,
        marginTop: 1,
    },
    commentText: {
        ...styles.caption1,
        color: colors.Primary100,
        marginLeft: 3,
        marginRight: 7,
    },
    mentionImage: {
        width: 20,
        height: 20,
        borderRadius: 100,
    },
    smallMentionImage: {
        width: 16,
        height: 16,
        borderRadius: 100,
    },
    svg: {
        overflow: 'hidden',
    },
})
