import { DV_TAB_ROOT_CHATS, DV_TAB_ROOT_UPDATES } from '../../utils/TabNavigationConstants'
import { colors } from '../styles/global'

import { adaptiveColor } from '../../Themes/colorMode'

// Same look as the assistant-mode button: Primary100 icon on the light blue it
// uses for hover. The background keeps the icon readable on the dark-blue
// mobile top bar of the default theme, where a blue icon alone would vanish.
export const SELECTED_TOP_BAR_ICON_COLOR = colors.Primary100

export const selectedTopBarButtonStyle = {
    backgroundColor: adaptiveColor('#E2EFFF'),
    borderRadius: 6,
}

// AT-2979: the top bar's Chats and Updates buttons mark themselves as selected
// while their root view is on screen. `route` is the signal, not
// `selectedSidebarTab`: the sidebar tab survives opening a detail view (a task
// opened from Updates still has ROOT_UPDATES selected), while every screen
// replaces `route` when it mounts, so the selection clears on any navigation.
export const isUpdatesViewActive = state => state.route === DV_TAB_ROOT_UPDATES

export const isChatsViewActive = state => state.route === DV_TAB_ROOT_CHATS
