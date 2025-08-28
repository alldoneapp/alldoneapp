import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CloseButton from '../../../FollowUp/CloseButton'
import { generatorParserCustomElement, generatorParserTextElement } from '../../../Feeds/Utils/HelperFunctions'
import Icon from '../../../Icon'
import MultilineParser from '../../../Feeds/TextParser/MultilineParser'

export default function Header({ closeModal, title, description }) {
    const parseFeed = () => {
        const elementsData = []

        const icon = generatorParserCustomElement(
            <Icon style={{ marginTop: 2, marginRight: 4 }} name="info" size={18} color={colors.Text03} />
        )
        elementsData.push(icon)

        const text = generatorParserTextElement([localStyles.description, { overflow: 'hidden' }], description)
        elementsData.push(text)

        return elementsData
    }

    const elementsData = parseFeed()

    return (
        <View style={localStyles.container}>
            <CloseButton style={localStyles.closeButton} close={closeModal} />
            <Text style={localStyles.title}>{title}</Text>
            <MultilineParser elementsData={elementsData} externalContainerStyle={localStyles.descriptionContainer} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    descriptionContainer: {
        paddingRight: 0,
        marginLeft: 0,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginLeft: 4,
    },
    closeButton: {
        top: -8,
        right: -8,
    },
})
