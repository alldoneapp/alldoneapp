import React from 'react'
import store from '../../redux/store'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import { setSearchText, showGlobalSearchPopup } from '../../redux/actions'
import { useSelector } from 'react-redux'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import { MENTION_SPACE_CODE } from '../Feeds/Utils/HelperFunctions'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { getDvMainTabLink } from '../../utils/LinkingHelper'
import { getCustomStyle } from '../../utils/HelperFunctions'

export default function MentionTag({
    inTaskDV,
    user,
    text,
    style,
    tagStyle,
    useCommentTagStyle,
    projectId,
    disabled,
    avatarSize,
    textStyle,
    tagContainerStyle,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const parsedText = text.replaceAll(MENTION_SPACE_CODE, ' ')
    const onPressTag = () => {
        if (user) {
            if (TasksHelper.getUserInProject(projectId, user.uid)) {
                URLTrigger.processUrl(NavigationService, getDvMainTabLink(projectId, user.uid, 'users'))
            } else {
                URLTrigger.processUrl(NavigationService, getDvMainTabLink(projectId, user.uid, 'contacts'))
            }
        } else {
            store.dispatch([setSearchText(`@${parsedText}`), showGlobalSearchPopup(false)])
        }
    }

    const getAvatarStyle = () => {
        const finalStyle = inTaskDV
            ? localStyles.bigMentionImage
            : useCommentTagStyle
            ? localStyles.smallMentionImage
            : localStyles.mentionImage

        return [finalStyle, avatarSize && { width: avatarSize, height: avatarSize, borderRadius: 100 }]
    }

    const getSvgDimentions = () => {
        return avatarSize
            ? { width: avatarSize, height: avatarSize }
            : inTaskDV
            ? { width: 24, height: 24 }
            : useCommentTagStyle
            ? { width: 16, height: 16 }
            : { width: 20, height: 20 }
    }

    return (
        <View>
            <Text style={[localStyles.centeredFlex, tagStyle]}>
                <View
                    style={[
                        localStyles.mentionSubView,
                        user && { paddingLeft: 2 },
                        getCustomStyle(inTaskDV, user, useCommentTagStyle),
                        tagContainerStyle,
                    ]}
                >
                    {user ? (
                        user.photoURL ? (
                            <Image source={{ uri: user.photoURL }} style={getAvatarStyle()} />
                        ) : (
                            <View style={[localStyles.svg, getAvatarStyle()]}>
                                <SVGGenericUser
                                    width={getSvgDimentions().width}
                                    height={getSvgDimentions().height}
                                    svgid={user.uid}
                                />
                            </View>
                        )
                    ) : (
                        <Icon
                            size={avatarSize || (inTaskDV ? 18 : useCommentTagStyle ? 14 : 16)}
                            name="at-sign"
                            color={colors.Green300}
                        />
                    )}
                    <View style={{ paddingLeft: inTaskDV ? 7 : useCommentTagStyle ? 2 : 4 }}>
                        <TouchableOpacity
                            onPress={onPressTag}
                            onClick={e => {
                                e.stopPropagation()
                            }}
                            disabled={loggedUser.isAnonymous || disabled || (user && user.temperature)}
                        >
                            <Text
                                style={[
                                    styles.subtitle2,
                                    inTaskDV && styles.title6,
                                    useCommentTagStyle && { ...styles.caption1 },
                                    { ...style, color: colors.Green300 },
                                    !inTaskDV && windowTagStyle(),
                                    textStyle,
                                ]}
                            >
                                {parsedText}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    centeredFlex: {
        display: 'flex',
        alignItems: 'center',
    },
    mentionSubView: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Green125,
        borderRadius: 50,
        paddingRight: 8,
        paddingLeft: 4,
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
    bigMentionImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    mentionImageComment: {
        width: 16,
        height: 16,
    },
    svg: {
        overflow: 'hidden',
    },
})
