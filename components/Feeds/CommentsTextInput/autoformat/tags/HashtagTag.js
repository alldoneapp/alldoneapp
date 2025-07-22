import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles from '../../../../styles/global'
import Icon from '../../../../Icon'
import { useSelector } from 'react-redux'
import { HASHTAG_COLOR_MAPPING } from '../../../../NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import { removeColor } from '../../../../../functions/Utils/hashtagUtils'
import { shrinkTagText } from '../../../../../functions/Utils/parseTextUtils'

export default function HashtagTag({ text, onPress, disabled, colorKey }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)

    const textLimit = mobile ? 15 : tablet ? 20 : 25
    const cleanedText = removeColor(text)

    return (
        <TouchableOpacity
            onPress={onPress}
            style={[localStyles.tag, { backgroundColor: HASHTAG_COLOR_MAPPING[colorKey].tagBack }]}
            disabled={disabled}
        >
            <Icon name={'hash'} size={16} color={HASHTAG_COLOR_MAPPING[colorKey].tagText} />
            <Text style={[localStyles.text, { color: HASHTAG_COLOR_MAPPING[colorKey].tagText }]} numberOfLines={1}>
                {shrinkTagText(cleanedText, textLimit)}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        ...styles.subtitle2,
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        fontSize: 18,
        paddingLeft: 4,
        paddingRight: 8,
        height: 24,
        maxWidth: '100%',
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        marginLeft: -2,
        marginTop: 1,
    },
})
