import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import useEscapeKey from '../../hooks/useEscapeKey'

/**
 * The canonical presentational confirm card (MODAL_IMPROVEMENT_PLAN.md,
 * confirm-dialog consolidation). A card only — the host owns positioning:
 * render it as AppPopover content (typically with
 * `contentLocation={popoverToCenter}` on desktop) and it becomes a bottom
 * sheet on mobile automatically. `title`/`description` are translation keys.
 * Escape goes through the LIFO stack; Enter confirms while nothing above is
 * consuming it.
 */
export default function ConfirmDialog({
    title,
    description,
    descriptionParams,
    onProceed,
    closeModal,
    proceedTitle = 'Proceed',
    proceedType = 'danger',
    processingTitle = 'Loading',
}) {
    const [processing, setProcessing] = useState(false)

    useEscapeKey(() => {
        if (!processing) closeModal()
    })

    const onPress = async () => {
        if (processing) return
        setProcessing(true)
        await onProceed()
        setProcessing(false)
    }

    useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Enter') onPress()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={{ paddingHorizontal: 16 }}>
                <Text style={[styles.title7, { color: 'white' }]}>{translate(title)}</Text>
                <Text style={[styles.body2, { color: colors.Text03 }]}>
                    {translate(description, descriptionParams)}
                </Text>
            </View>
            <View style={localStyles.buttons}>
                <Button
                    title={translate('Cancel')}
                    type={'secondary'}
                    buttonStyle={{ marginRight: 8 }}
                    onPress={closeModal}
                    disabled={processing}
                />
                <Button
                    title={translate(proceedTitle)}
                    type={proceedType}
                    onPress={onPress}
                    disabled={processing}
                    processing={processing}
                    processingTitle={translate(processingTitle)}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
})
