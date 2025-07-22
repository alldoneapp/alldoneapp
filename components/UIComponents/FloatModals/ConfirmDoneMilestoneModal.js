import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import v4 from 'uuid/v4'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import MultilineParser from '../../Feeds/TextParser/MultilineParser'
import { generatorParserCustomElement, generatorParserTextElement } from '../../Feeds/Utils/HelperFunctions'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'
import { watchBaseGoalsAmountInOpenMilestone } from '../../../utils/backends/Goals/goalsFirestore'
import Backend from '../../../utils/BackendBridge'
import store from '../../../redux/store'
import { getOwnerId } from '../../GoalsView/GoalsHelper'

export default function ConfirmDoneMilestoneModal({ moveMilestoneToDone, closeModal, projectId, milestoneDate }) {
    const [affectGoalsAmount, setAffectGoalsAmount] = useState(0)

    const parseFeed = () => {
        const elementsData = []

        const icon = generatorParserCustomElement(
            <Icon style={{ marginTop: 2, marginRight: 4 }} name="info" size={18} color={colors.Text03} />
        )
        elementsData.push(icon)

        const description = translate('Mark Milestone as done description', { amount: affectGoalsAmount })
        const text = generatorParserTextElement([localStyles.description, { overflow: 'hidden' }], description)
        elementsData.push(text)

        return elementsData
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Escape') {
            closeModal()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        const { currentUser } = store.getState()
        const ownerId = getOwnerId(projectId, currentUser.uid)
        const watcherKey = v4()
        watchBaseGoalsAmountInOpenMilestone(projectId, milestoneDate, setAffectGoalsAmount, watcherKey, ownerId)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    const elementsData = parseFeed()

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <Text style={localStyles.title}>{translate('Mark Milestone as done?')}</Text>

            <MultilineParser elementsData={elementsData} externalContainerStyle={localStyles.descriptionContainer} />
            <View style={localStyles.buttonsContainer}>
                <Button title={translate('Cancel')} type="secondary" onPress={closeModal} shortcutText={'Enter'} />
                <Button
                    title={translate('Mark as done for all users')}
                    type={'primary'}
                    buttonStyle={{ marginLeft: 8 }}
                    onPress={moveMilestoneToDone}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
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
    buttonsContainer: {
        flex: 1,
        minHeight: 40,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 20,
    },
})
