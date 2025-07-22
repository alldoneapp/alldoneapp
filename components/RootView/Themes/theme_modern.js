import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'

const ThemeColors = {
    RootView: {
        // NotesItem component
        StickyItem: {
            containerSticky: color => ({
                backgroundColor:
                    PROJECT_COLOR_SYSTEM[color]?.PROJECT_ITEM_SECTION_ITEM ||
                    PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]?.PROJECT_ITEM_SECTION_ITEM,
            }),
        },
    },
}

export default ThemeColors
