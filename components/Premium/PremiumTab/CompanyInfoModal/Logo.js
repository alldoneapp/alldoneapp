import React from 'react'
import { StyleSheet, View, TouchableOpacity, Text, Image } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'
import AttachmentsTag from '../../../FollowUp/AttachmentsTag'

export default function Logo({ updateLogo, logo }) {
    const removeLogo = () => {
        updateLogo('')
    }

    const pickLogo = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 1,
        })

        if (!result.cancelled) {
            Image.getSize(result.uri, () => {
                updateLogo(result.uri)
            })
        }
    }

    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.uploadButton} onPress={pickLogo}>
                <Icon name="folder-plus" size={24} color={colors.Text03} />
                <Text style={localStyles.text}>{translate('Upload logo')}</Text>
            </TouchableOpacity>
            {!!logo && <AttachmentsTag text={'Logo'} removeTag={removeLogo} style={localStyles.tag} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    uploadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginLeft: 8,
    },
    tag: {
        alignSelf: 'center',
        marginLeft: 8,
    },
})
