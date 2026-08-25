import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { getAssistantTemplateReviewCount, getAssistantTemplateReviewLabelKey } from './templateReview'
import { getTemplateConflictFieldNames } from './templateConflictFields'

/**
 * Read-only "your template moved on" notice for the assistant board (AT-2425).
 *
 * The sidebar already marks a pending review (`AssistantItem`), but opening the
 * assistant used to drop the signal entirely: the board shows the assistant line
 * and its tasks, and the only place that says anything is `UpdateFromTemplate`,
 * one Edit click away on the detailed view's Customizations tab. So the one
 * surface the marker sends you to was the one surface that stayed silent.
 *
 * This says what changed and points at Edit; it deliberately does NOT resolve
 * anything. `UpdateFromTemplate` stays the single place where a side is picked —
 * duplicating the Keep mine / Accept template pair here would mean two writers
 * for one decision, and it would put a full side-by-side diff panel on top of a
 * task board.
 *
 * Same predicate (`getAssistantTemplateReviewCount`) and same yellow language as
 * the sidebar and the resolve panel, so the three surfaces cannot disagree about
 * whether there is something to review.
 */
export default function AssistantTemplateReviewBanner({ assistant, onReview }) {
    const count = getAssistantTemplateReviewCount(assistant)
    if (!count) return null

    // Built exactly like the sidebar's accessibility label: the count is
    // prefixed by the caller, the key carries only the singular/plural wording.
    const reviewLabel = `${count} ${translate(getAssistantTemplateReviewLabelKey(count))}`
    const fieldNames = getTemplateConflictFieldNames(assistant)
    const detail = fieldNames.length ? `${reviewLabel}: ${fieldNames.join(', ')}` : reviewLabel

    return (
        <View style={localStyles.container} accessibilityLabel={reviewLabel}>
            <Icon name={'alert-circle'} size={20} color={colors.UtilityYellow300} style={localStyles.icon} />
            <View style={localStyles.copy}>
                <Text style={localStyles.headline}>{translate("This assistant's template was updated")}</Text>
                <Text style={localStyles.detail}>{detail}</Text>
                <Text style={localStyles.hint}>{translate('Click Edit to choose which version to keep.')}</Text>
                {!!onReview && (
                    <View style={localStyles.action}>
                        <Button
                            type={'ghost'}
                            icon={'edit-2'}
                            title={translate('Review changes')}
                            onPress={onReview}
                            buttonStyle={localStyles.button}
                        />
                    </View>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.UtilityYellow100,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.UtilityYellow150,
        padding: 16,
        marginTop: 16,
    },
    // Nudged onto the headline's optical centre; the icon box is 20px tall
    // against a 24px title line.
    icon: { marginRight: 12, marginTop: 2 },
    copy: { flex: 1 },
    headline: { ...styles.subtitle1, color: colors.Text01 },
    detail: { ...styles.body2, color: colors.UtilityYellow300, marginTop: 4 },
    hint: { ...styles.caption1, color: colors.Text02, marginTop: 4 },
    action: { flexDirection: 'row', marginTop: 12 },
    button: { marginLeft: 0 },
})
