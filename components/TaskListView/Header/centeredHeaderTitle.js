import React, { useCallback, useState } from 'react'
import { View } from 'react-native'

/**
 * AT-3132: the top header line ("All projects", or the selected project's line) centres its title
 * block on the FULL header, like the section card and the assistant header below it, not on the
 * room left beside the actions on the right.
 *
 * The actions stay in the row (so they keep their place, their tap targets and the rule that the
 * title gives way to them, AT-2263); an invisible spacer of the same measured width on the left
 * mirrors them. The title area between the two is then symmetric, so centring inside it centres
 * on the whole line, and a long name truncates inside it instead of running under the menu.
 *
 * Only the top line is centred: the per-project lines in the All projects lists stay left aligned.
 *
 * Mobile sizes only: the centring applies where `smallScreenNavigation` is set (the app's mobile
 * navigation breakpoint, utils/responsiveLayout.js). On desktop the line stays left aligned as it
 * was before AT-3132 (reviewer decision), with no spacer.
 */

// The project line is the selected project's top line, not one of the per-project lines of an
// All projects list (where `selectedProjectIndex` is ALL_PROJECTS_INDEX, -1).
export const isSelectedProjectHeader = (selectedProjectIndex, projectIndex) =>
    typeof selectedProjectIndex === 'number' && selectedProjectIndex >= 0 && selectedProjectIndex === projectIndex

// The selected project's top line is centred on mobile sizes only.
export const shouldCenterProjectHeaderTitle = (smallScreenNavigation, selectedProjectIndex, projectIndex) =>
    !!smallScreenNavigation && isSelectedProjectHeader(selectedProjectIndex, projectIndex)

// Width of the actions cluster on the right, mirrored by the spacer on the left. Rounded up so a
// sub-pixel width never leaves the title one pixel off-centre, and only stored when it changes.
export const useMirroredActionsWidth = () => {
    const [width, setWidth] = useState(0)
    const onLayout = useCallback(({ nativeEvent }) => {
        const next = Math.max(0, Math.ceil(nativeEvent?.layout?.width || 0))
        setWidth(previous => (previous === next ? previous : next))
    }, [])
    return [width, onLayout]
}

export function MirroredActionsSpacer({ width, testID }) {
    return <View testID={testID} pointerEvents="none" style={{ width, flexShrink: 0 }} />
}
