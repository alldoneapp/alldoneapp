import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import AttachmentsTag from '../../../FollowUp/AttachmentsTag'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'

export default function CommentOption({ openCommentModal, comment, removeComment }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <View style={localStyles.container}>
            <Hotkeys keyName={'1'} onKeyDown={openCommentModal} filter={e => true}>
                <TouchableOpacity style={localStyles.button} onPress={openCommentModal}>
                    <Icon name="message-circle" size={24} color="white" />
                    <Text style={localStyles.text}>{translate('Add comment')}</Text>
                    <View style={{ marginLeft: 'auto' }}>
                        {smallScreenNavigation ? (
                            <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                        ) : (
                            <Shortcut text={'1'} theme={SHORTCUT_LIGHT} />
                        )}
                    </View>
                </TouchableOpacity>
            </Hotkeys>
            {comment !== '' && (
                <AttachmentsTag
                    text={comment.substring(0, 20)}
                    removeTag={removeComment}
                    ico="message-circle"
                    maxWidth={133}
                    style={localStyles.commentTag}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    button: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle1,
        color: 'white',
        marginLeft: 8,
    },
    commentTag: {
        marginTop: 10,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        overflow: 'hidden',
        flexWrap: 'wrap',
        marginRight: 4,
    },
})
