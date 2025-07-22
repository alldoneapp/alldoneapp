import React, { useEffect, useState } from 'react'
import v4 from 'uuid/v4'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../Icon'
import styles, { windowTagStyle } from '../styles/global'
import { addHashtagFilters, removeHashtagFilters, startLoadingData, stopLoadingData } from '../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import {
    COLOR_KEY_4,
    HASHTAG_COLOR_MAPPING,
} from '../NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import Backend from '../../utils/BackendBridge'
import { removeColor } from '../../functions/Utils/hashtagUtils'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { getCustomStyle } from '../../utils/HelperFunctions'

export default function HashTag({
    projectId,
    inTaskDV,
    useCommentTagStyle,
    style,
    tagStyle,
    text,
    disabled,
    iconSize,
    textStyle,
    tagContainerStyle,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const hashtagsColors = useSelector(state => state.hashtagsColors)
    const hashtagFilters = useSelector(state => state.hashtagFilters)
    const [tagId, setTagId] = useState(v4())
    const dispatch = useDispatch()

    const textLimit = mobile ? 15 : tablet ? 20 : 25

    const cleanedText = removeColor(text)
    const parsedText = cleanedText.toLowerCase()
    const colorKey = hashtagsColors?.[projectId]?.[parsedText] || COLOR_KEY_4
    const inFilters = hashtagFilters.has(`#${cleanedText}`)

    const onPressTag = () => {
        const filterToDispatch = inFilters ? removeHashtagFilters : addHashtagFilters
        dispatch(filterToDispatch(`#${cleanedText}`, colorKey))
    }

    useEffect(() => {
        if (!hashtagsColors?.[projectId]?.[parsedText]) dispatch(startLoadingData())
        return () => dispatch(stopLoadingData())
    }, [])

    useEffect(() => {
        const cleanedText = removeColor(text)
        Backend.watchHastagsColors(projectId, tagId, cleanedText, () => dispatch(stopLoadingData()))
        return () => {
            Backend.unwatchHastagsColors(tagId)
        }
    }, [projectId, text, tagId])

    return (
        <View>
            <Text style={[{ display: 'flex', alignItems: 'center' }, tagStyle]}>
                <TouchableOpacity
                    onPress={onPressTag}
                    onClick={e => {
                        e.stopPropagation()
                    }}
                    disabled={disabled}
                >
                    <View
                        style={[
                            localStyles.hashtag,
                            { backgroundColor: HASHTAG_COLOR_MAPPING[colorKey].tagBack },
                            getCustomStyle(inTaskDV, null, useCommentTagStyle),
                            tagContainerStyle,
                        ]}
                    >
                        <Icon
                            size={iconSize || (inTaskDV ? 18 : useCommentTagStyle ? 14 : 16)}
                            name="hash"
                            color={HASHTAG_COLOR_MAPPING[colorKey].tagText}
                        />
                        <View style={{ marginLeft: -2 }}>
                            <Text
                                style={[
                                    styles.subtitle2,
                                    inTaskDV && styles.title6,
                                    useCommentTagStyle && { ...styles.caption1 },
                                    { ...style, color: HASHTAG_COLOR_MAPPING[colorKey].tagText },
                                    !inTaskDV && windowTagStyle(),
                                    textStyle,
                                ]}
                            >
                                {shrinkTagText(cleanedText, textLimit)}
                            </Text>
                        </View>
                    </View>
                </TouchableOpacity>
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    hashtag: {
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        paddingRight: 8,
        paddingLeft: 4,
    },
})
