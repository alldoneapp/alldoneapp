import React from 'react'
import { View, Text, StyleSheet, Image } from 'react-native'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { parseFeedComment, URL_ELEMENT } from '../Utils/HelperFunctions'
import LinkTag from '../../Tags/LinkTag'

export default function MultilineParser({ elementsData, externalContainerStyle, parseText }) {
    const elements = []

    let elementCount = 0
    for (let i = 0; i < elementsData.length; i++) {
        const elementData = elementsData[i]
        const { type } = elementData
        if (type === 'image') {
            const { style, uri } = elementData
            elements.push(
                uri.startsWith(WORKSTREAM_ID_PREFIX) ? (
                    <Icon size={20} name="workstream" color={colors.Text03} style={style} />
                ) : (
                    <Image key={elementCount} style={style} source={{ uri: uri }} />
                )
            )
            elementCount++
        } else if (type === 'view') {
            const { style } = elementData
            elements.push(<View key={elementCount} style={style} />)
            elementCount++
        } else if (type === 'text') {
            const { style, styleEnd, text } = elementData

            if (parseText) {
                const elementsInText = parseFeedComment(text, false, false)
                let previousIsTag = false
                for (let n = 0; n < elementsInText.length; n++) {
                    const element = elementsInText[n]
                    const { type, link, text: elementText } = element
                    if (type === URL_ELEMENT) {
                        elements.push(
                            <LinkTag
                                key={elementCount}
                                link={link}
                                tagStyle={{ marginLeft: 4 }}
                                useCommentTagStyle={true}
                            />
                        )
                        previousIsTag = true
                    } else {
                        elements.push(
                            <Text
                                key={elementCount}
                                style={[
                                    style,
                                    n + 1 === elementsInText.length ? styleEnd : null,
                                    previousIsTag && { marginLeft: 0 },
                                ]}
                            >
                                {elementText}
                            </Text>
                        )
                        previousIsTag = false
                    }
                    elementCount++
                }
            } else {
                const words = text.split(' ')
                for (let n = 0; n < words.length; n++) {
                    elements.push(
                        <Text
                            key={elementCount}
                            style={[style, n + 1 === words.length ? styleEnd : null]}
                            children={words[n]}
                        />
                    )
                    elementCount++
                }
            }
        } else if (type === 'custom') {
            const { component } = elementData
            elements.push(component)
        }
    }

    return <View style={[localStyles.body, externalContainerStyle]}>{elements}</View>
}

const localStyles = StyleSheet.create({
    body: {
        marginLeft: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        flex: '1',
        paddingRight: 8,
    },
})
