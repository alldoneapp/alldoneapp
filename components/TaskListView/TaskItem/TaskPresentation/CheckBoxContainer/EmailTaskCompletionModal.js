import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import { translate } from '../../../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../../../utils/HelperFunctions'
import Button from '../../../../UIControls/Button'
import Header from '../../../../UIComponents/FloatModals/DueDateModal/Header'
import { colors } from '../../../../styles/global'

export default function EmailTaskCompletionModal({ closePopover, onComplete, submitting }) {
    const selectionStartedRef = useRef(false)

    useEffect(() => {
        if (!submitting) selectionStartedRef.current = false
    }, [submitting])

    const selectOption = (archiveEmail, event) => {
        event?.preventDefault()
        event?.stopPropagation()
        if (submitting || selectionStartedRef.current) return
        selectionStartedRef.current = true
        onComplete(archiveEmail)
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <Header
                delayClosePopover={closePopover}
                title={translate('Complete email task')}
                description={translate('Would you also like to archive the linked email?')}
                showTabs={false}
            />
            <View style={localStyles.buttons}>
                <Hotkeys keyName={'1'} onKeyDown={(shortcut, event) => selectOption(true, event)} filter={() => true}>
                    <Button
                        testID={'email-task-complete-and-archive'}
                        type={'primary'}
                        icon={'archive'}
                        title={translate('Complete and archive email')}
                        processing={submitting}
                        processingTitle={translate('Archiving email')}
                        disabled={submitting}
                        onPress={event => selectOption(true, event)}
                        buttonStyle={localStyles.button}
                        accessible={true}
                        accessibilityLabel={translate('Complete and archive email')}
                    />
                </Hotkeys>
                <Hotkeys keyName={'2'} onKeyDown={(shortcut, event) => selectOption(false, event)} filter={() => true}>
                    <Button
                        testID={'email-task-complete-only'}
                        type={'secondary'}
                        icon={'check'}
                        title={translate('Only complete task')}
                        disabled={submitting}
                        onPress={event => selectOption(false, event)}
                        buttonStyle={localStyles.button}
                        accessible={true}
                        accessibilityLabel={translate('Only complete task')}
                    />
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 16,
        borderRadius: 4,
    },
    buttons: {
        paddingHorizontal: 16,
    },
    button: {
        width: '100%',
        alignSelf: 'stretch',
        marginTop: 8,
    },
})
