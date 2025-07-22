import React from 'react'
import { View, StyleSheet } from 'react-native'

import AttachmentsTag from './AttachmentsTag'
import { isPicture } from '../Feeds/Utils/HelperFunctions'

export default CommentTagsSection = ({ comment, files, removeComment, removeFile }) => {
    const tagsData = [
        {
            text: comment,
            ico: 'message-circle',
            removeAction: removeComment,
        },
    ]

    files.forEach((data, index) => {
        const { file } = data
        const { type, name } = file
        const isImage = isPicture(type)
        const ico = isImage ? 'image' : 'paperclip'
        const removeAction = () => {
            removeFile(index)
        }
        tagsData.push({
            text: name,
            ico,
            removeAction,
        })
    })

    return (
        <View style={localStyles.tagsContainer}>
            {tagsData.map((data, index) => {
                const { text, ico, removeAction } = data
                return (
                    <AttachmentsTag
                        text={text.substring(0, 20)}
                        removeTag={removeAction}
                        ico={ico}
                        style={localStyles.tag}
                        maxWidth={133}
                        key={`${text}${index}`}
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    tagsContainer: {
        flexDirection: 'row',
        width: 273,
        flexWrap: 'wrap',
        marginLeft: -4,
    },
    tag: {
        marginBottom: 8,
        marginLeft: 4,
    },
})
