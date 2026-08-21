import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { translate } from '../../../i18n/TranslationService'
import { PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import styles, { colors } from '../../styles/global'

// The row is a stand-in for a real goal row, so its geometry deliberately mirrors
// components/GoalsView:
//   GoalProgressBar  -> a 61px wide, full-height bar on the left   = `blockContainer`
//                       (4 paddingLeft + 52 block + 5 paddingRight = 61)
//   GoalProgress     -> the 52x32 percentage box inside it         = `block`
//   GoalProgressWrapper offsets that box by marginTop: 4           = `blockContainer.paddingTop`
// Keeping those numbers aligned is what makes the "General tasks" title line up with the
// goal titles rendered directly below it in the same list.
export const GENERAL_TASKS_HEADER_MIN_HEIGHT = 40
// The header stays a single line and ellipsis-truncates a project name that does not fit,
// rather than wrapping and growing the row.
export const GENERAL_TASKS_HEADER_MAX_LINES = 1

export default function GeneralTasksHeader({ projectId }) {
    const project = ProjectHelper.getProjectById(projectId)
    if (!project) return null
    const conatinerColor = PROJECT_COLOR_SYSTEM[project.color].PROJECT_ITEM_ACTIVE
    const blockColor = PROJECT_COLOR_SYSTEM[project.color].PROJECT_ITEM_SECTION_ITEM_ACTIVE

    return (
        <View style={[localStyles.container, { borderColor: conatinerColor }]}>
            <View style={[localStyles.blockContainer, { backgroundColor: conatinerColor }]}>
                <View style={[localStyles.block, { borderColor: blockColor }]} />
            </View>
            <Text style={localStyles.text} numberOfLines={GENERAL_TASKS_HEADER_MAX_LINES}>
                {translate(`General tasks`)}: {project.name}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginVertical: 4,
        paddingRight: 4,
        // `minHeight`, never a hard `height` (AT-2399). The row is designed to stay one line
        // tall, and with the title clamped to a single line it always is — but a hard height
        // is what turned "the title needs more room than the row has" into text painted
        // across the card border instead of a taller card. Keeping `minHeight` means any
        // future change (a larger body1, a second element in the row) degrades safely.
        minHeight: GENERAL_TASKS_HEADER_MIN_HEIGHT,
        alignItems: 'stretch',
        borderRadius: 4,
        borderWidth: 1,
        flexDirection: 'row',
        width: '100%',
    },
    blockContainer: {
        // Full row height, the way GoalProgressBar uses height: '100%'. Paired with the
        // container's `minHeight`: if the row is ever taller than one line, the coloured
        // panel grows with it instead of floating in the middle of the card.
        alignSelf: 'stretch',
        alignItems: 'flex-start',
        borderRadius: 4,
        flexDirection: 'row',
        paddingLeft: 4,
        paddingRight: 5,
        // 3 + the container's 1px border = the 4px top offset GoalProgressWrapper applies to
        // GoalProgress on a real goal row, and it keeps the block pinned to the first line
        // rather than re-centring if the row ever grows.
        paddingTop: 3,
    },
    block: {
        width: 52,
        height: 32,
        borderRadius: 4,
        borderWidth: 2,
        backgroundColor: '#ffffff',
    },
    text: {
        ...styles.body1,
        color: colors.Text01,
        marginLeft: 7,
        // Take the width the block leaves over rather than widening the row...
        flex: 1,
        // ...and be allowed to shrink below that text's own width, which is what actually
        // produces the ellipsis. A flex item's `min-width` defaults to `auto` = its
        // min-content size, and `numberOfLines={1}` makes react-native-web set
        // `white-space: nowrap`, so min-content is the WHOLE untruncated string: without
        // this the title refuses to shrink and overflows the row sideways instead of
        // truncating. react-native-web gives `View` a `minWidth: 0` but not `Text`.
        minWidth: 0,
        alignSelf: 'center',
        marginVertical: 4,
    },
})
