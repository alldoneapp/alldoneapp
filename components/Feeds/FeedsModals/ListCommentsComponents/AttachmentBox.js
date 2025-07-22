import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import Spinner from '../../../UIComponents/Spinner'
import { colors } from '../../../styles/global'

export default function AttachmentBox({ attachment }) {
    const [imgHeight, setImgHeight] = useState(0)
    const openLink = link => {
        Linking.canOpenURL(link, '_blank').then(() => {
            if (window) {
                return window.open(link, '_blank')
            } else {
                return Linking.openURL(link, '_blank')
            }
        })
    }

    const linkComponent = (child, uri) => {
        return (
            <a href={uri} target={'_blank'} style={{ textDecoration: 'none' }}>
                {child}
            </a>
        )
    }

    const showImagePreview = mimeType => {
        const mimeTypeList = [
            'image/bmp',
            'image/gif',
            'image/vnd.microsoft.icon',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/svg+xml',
            'image/tiff',
            'image/webp',
        ]

        return mimeTypeList.indexOf(mimeType) >= 0
    }

    useEffect(() => {
        if (showImagePreview(attachment.mimeType)) {
            Image.getSize(attachment.uri, (width, height) => {
                setImgHeight(height * (273 / width))
            })
        }
    }, [])

    return (
        <View style={{ marginTop: 8 }}>
            {showImagePreview(attachment.mimeType) && (
                <View style={localStyles.imagePreviewContainer}>
                    {imgHeight > 0 ? (
                        linkComponent(
                            <Image
                                style={[localStyles.imagePreview, { height: imgHeight }]}
                                source={{ uri: attachment.uri }}
                            />,
                            attachment.uri
                        )
                    ) : (
                        <View style={{ marginVertical: 70 }}>
                            <Spinner containerSize={32} spinnerSize={16} />
                        </View>
                    )}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    imagePreviewContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.Primary100,
        overflow: 'hidden',
    },
    imagePreview: {
        width: 273,
    },
})
