import { StyleSheet } from 'react-native'

import styles, { colors } from '../../styles/global'
import { MODAL_BACKDROP_COLOR } from '../../styles/modals'
import { themed } from '../../../Themes/colorMode'

// Navy popup palette (docs/claude/dark-mode.md): Secondary400 card, Secondary300 rows/dividers,
// Secondary200 chips; light tokens as text. The root carries dataSet adPopup so dark mode keeps
// these light values.
export const planStyles = StyleSheet.create({
    scrim: {
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: MODAL_BACKDROP_COLOR,
        alignItems: 'center',
        justifyContent: 'center',
    },
    card: {
        backgroundColor: colors.Secondary400,
        borderRadius: 8,
        boxShadow: themed.PopupShadow,
        overflow: 'hidden',
    },
    sheetCard: {
        borderRadius: 12,
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
        paddingRight: 48,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    subtitle: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    closeButton: {
        position: 'absolute',
        right: 8,
        top: 8,
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scroll: {
        paddingHorizontal: 16,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: colors.Secondary300,
    },
    footerSpacer: {
        flex: 1,
        minWidth: 8,
    },
    footerNote: {
        ...styles.caption2,
        color: colors.Text03,
        flexShrink: 1,
    },
    // capacity card
    capacityCard: {
        backgroundColor: colors.Secondary300,
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
    },
    capacityRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
    },
    capacityBig: {
        ...styles.title6,
        color: '#ffffff',
        marginRight: 6,
    },
    capacityLabel: {
        ...styles.caption1,
        color: colors.Grey400,
        marginRight: 12,
    },
    capacityDetail: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
    },
    barTrack: {
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary200,
        marginTop: 10,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    barFill: {
        height: 8,
        backgroundColor: colors.Primary100,
    },
    barOver: {
        backgroundColor: colors.UtilityOrange200,
    },
    warning: {
        color: colors.UtilityOrange200,
    },
    ok: {
        color: colors.UtilityGreen200,
    },
    // chips and small buttons
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 8,
    },
    chip: {
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: colors.Secondary200,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 6,
        marginBottom: 4,
    },
    chipSelected: {
        backgroundColor: colors.Primary100,
    },
    chipText: {
        ...styles.caption1,
        color: '#ffffff',
    },
    linkText: {
        ...styles.caption1,
        color: colors.UtilityBlue125 || colors.Primary100,
    },
    // overload
    overloadCard: {
        borderWidth: 1,
        borderColor: colors.UtilityOrange200,
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
    },
    overloadTitle: {
        ...styles.subtitle2,
        color: colors.UtilityOrange200,
    },
    bodyText: {
        ...styles.body2,
        color: '#ffffff',
    },
    mutedText: {
        ...styles.caption2,
        color: colors.Text03,
    },
    // search
    search: {
        ...styles.body2,
        color: '#ffffff',
        backgroundColor: themed.PopupFieldFill,
        borderWidth: 1,
        borderColor: themed.PopupFieldBorder,
        borderRadius: 4,
        paddingHorizontal: 10,
        minHeight: 36,
        marginBottom: 8,
        outlineStyle: 'none',
    },
    // project groups
    projectHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        paddingTop: 12,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: colors.Secondary300,
    },
    projectDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.Text03,
        marginRight: 8,
    },
    projectName: {
        ...styles.subtitle1,
        color: '#ffffff',
        flexShrink: 1,
        marginRight: 8,
    },
    projectMeta: {
        ...styles.caption1,
        color: colors.Grey400,
        marginRight: 8,
    },
    tierCounts: {
        ...styles.caption2,
        color: colors.Text03,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.Secondary300,
    },
    rowButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
        marginRight: 8,
    },
    taskName: {
        ...styles.body2,
        color: '#ffffff',
    },
    reason: {
        ...styles.caption2,
        color: colors.Text03,
    },
    rowControls: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
    },
    smallChip: {
        minHeight: 26,
        minWidth: 40,
        paddingHorizontal: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary200,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
    },
    smallChipText: {
        ...styles.caption1,
        color: '#ffffff',
    },
    unknownEstimate: {
        color: colors.UtilityOrange400 || colors.UtilityOrange200,
    },
    laterToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 36,
    },
    laterToggleText: {
        ...styles.caption1,
        color: colors.Grey400,
        marginLeft: 4,
    },
    // postpone
    reconciliation: {
        ...styles.body2,
        color: '#ffffff',
        marginBottom: 8,
    },
    destinationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        borderBottomWidth: 1,
        borderBottomColor: colors.Secondary300,
    },
    destinationTitle: {
        ...styles.subtitle2,
        color: '#ffffff',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    checkboxChecked: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    partialMark: {
        width: 10,
        height: 2,
        borderRadius: 1,
        backgroundColor: '#ffffff',
    },
    nested: {
        marginLeft: 32,
    },
    table: {
        marginTop: 12,
        marginBottom: 8,
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 28,
    },
    tableName: {
        ...styles.caption1,
        color: '#ffffff',
        flex: 1,
        minWidth: 0,
    },
    tableCell: {
        ...styles.caption1,
        color: colors.Grey400,
        width: 64,
        paddingLeft: 6,
        textAlign: 'right',
    },
    tableSum: {
        ...styles.caption1,
        color: colors.Grey400,
        marginLeft: 8,
        textAlign: 'right',
    },
    tableTotal: {
        borderTopWidth: 1,
        borderTopColor: colors.Secondary300,
    },
    error: {
        ...styles.body2,
        color: colors.UtilityOrange200,
        paddingHorizontal: 16,
        paddingTop: 8,
    },
})
