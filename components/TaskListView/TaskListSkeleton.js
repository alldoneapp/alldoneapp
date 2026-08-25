import React from 'react'
import { StyleSheet, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import GhostBlock from '../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../UIComponents/Ghosts/ghostAnimation'
import { GHOST_DEFAULT_ROWS } from '../UIComponents/Ghosts/ghostRowCount'
import { colors } from '../styles/global'

const TITLE_WIDTHS = ['58%', '74%', '46%', '66%']

/**
 * Loading rows shaped like the normal 34px task presentation. Keeping the
 * checkbox, title and trailing tag footprints aligned with a real task makes
 * the final replacement visually quiet instead of inserting a generic spinner.
 *
 * AT-2382 moved the animation onto the shared ghost primitive
 * (`components/UIComponents/Ghosts/`), so this now shimmers like every other loading
 * placeholder in the app; the row geometry below is unchanged and still mirrors
 * `TaskPresentationLayout` + `TitleContainer`'s derived 34px row.
 */
export default function TaskListSkeleton({
    rowCount = GHOST_DEFAULT_ROWS,
    showDateHeader = false,
    showProjectHeader = false,
    taskKeys = [],
    embedded = false,
}) {
    const { pulse, reducedMotion } = useGhostPulse()
    const rows = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="task-list-loading-skeleton"
            accessibilityLabel={translate('Loading tasks')}
            accessibilityRole="progressbar"
            style={!embedded && localStyles.container}
        >
            {showProjectHeader && (
                <View testID="task-project-loading-skeleton-header" style={localStyles.projectHeader}>
                    <GhostBlock
                        testID="task-project-loading-skeleton-leading-edge"
                        style={localStyles.projectLoadingLeadingEdge}
                        pulse={pulse}
                        reducedMotion={reducedMotion}
                        soft
                    />
                    <View style={localStyles.projectIdentity}>
                        <GhostBlock style={localStyles.projectIcon} pulse={pulse} reducedMotion={reducedMotion} />
                        <GhostBlock style={localStyles.projectName} pulse={pulse} reducedMotion={reducedMotion} />
                    </View>
                    <GhostBlock style={localStyles.projectActions} pulse={pulse} reducedMotion={reducedMotion} soft />
                </View>
            )}
            {showDateHeader && (
                <View style={localStyles.dateHeaderContainer}>
                    <GhostBlock style={localStyles.dateHeader} pulse={pulse} reducedMotion={reducedMotion} soft />
                </View>
            )}
            {rows.map((_, index) => (
                <View
                    key={taskKeys[index] || index}
                    testID="task-loading-skeleton-row"
                    style={localStyles.taskContainer}
                >
                    <View style={localStyles.taskRow}>
                        <GhostBlock style={localStyles.checkbox} pulse={pulse} reducedMotion={reducedMotion} />
                        <View style={localStyles.titleContainer}>
                            <GhostBlock
                                style={[localStyles.title, { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length] }]}
                                pulse={pulse}
                                reducedMotion={reducedMotion}
                            />
                        </View>
                        <GhostBlock style={localStyles.tag} pulse={pulse} reducedMotion={reducedMotion} soft />
                    </View>
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
    projectHeader: {
        position: 'relative',
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        marginHorizontal: -8,
        paddingHorizontal: 8,
        paddingTop: 25,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey400,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    // The observer fires as the first pixel enters the viewport. This leading
    // shimmer makes that boundary visible before the header's 25 px top inset.
    projectLoadingLeadingEdge: {
        position: 'absolute',
        top: 0,
        left: 8,
        right: 8,
        height: 4,
        borderRadius: 2,
    },
    projectIdentity: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
    },
    projectIcon: {
        width: 18,
        height: 18,
        borderRadius: 9,
    },
    projectName: {
        width: '42%',
        height: 12,
        marginLeft: 8,
        borderRadius: 6,
    },
    projectActions: {
        width: 88,
        height: 16,
        marginLeft: 12,
        borderRadius: 8,
    },
    dateHeaderContainer: {
        paddingTop: 8,
        paddingBottom: 8,
    },
    dateHeader: {
        height: 24,
        borderRadius: 4,
    },
    taskContainer: {
        justifyContent: 'center',
        marginLeft: -16,
        marginRight: -16,
    },
    taskRow: {
        height: 34,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 8,
        marginHorizontal: 8,
        borderRadius: 4,
    },
    checkbox: {
        width: 24,
        height: 24,
        marginTop: 8,
        borderRadius: 4,
    },
    titleContainer: {
        flex: 1,
        paddingLeft: 12,
    },
    title: {
        height: 12,
        marginTop: 11,
        borderRadius: 6,
    },
    tag: {
        width: 48,
        height: 16,
        marginTop: 9,
        marginRight: 8,
        borderRadius: 8,
    },
})
