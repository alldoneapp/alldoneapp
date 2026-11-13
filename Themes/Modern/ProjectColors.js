import Colors from '../Colors'
import {
    adaptiveColor,
    alphaColor,
    COLOR_MODE_DARK,
    getHighlightDisplayColor,
    modeColor,
    themed,
    tintForContrast,
} from '../colorMode'

export const PROJECT_COLOR_DEFAULT = Colors.Marker_PrimaryBlue_01
export const PROJECT_COLOR_BLUE = Colors.Marker_Blue_01
export const PROJECT_COLOR_RED = Colors.Marker_Red_01
export const PROJECT_COLOR_PURPLE = Colors.Marker_Purple_01
export const PROJECT_COLOR_GREEN = Colors.Marker_Green_01
export const PROJECT_COLOR_PINK = Colors.Marker_Pink_01
export const PROJECT_COLOR_ORANGE = Colors.Marker_Orange_01
export const PROJECT_COLOR_YELLOW = Colors.Marker_Yellow_01
export const PROJECT_COLOR_PELOROUS = Colors.Marker_Pelorous_01
export const PROJECT_COLOR_LIME = Colors.Marker_Lime_01
export const PROJECT_COLOR_VIOLET = Colors.Marker_Violet_01

const PROJECT_COLOR_SYSTEM_HEX = {
    [PROJECT_COLOR_DEFAULT]: {
        MARKER: Colors.Marker_PrimaryBlue_01,
        MARKER_TEXT: Colors.Marker_PrimaryBlue_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_PrimaryBlue_03,
        PROJECT_ITEM_SECTION: Colors.Marker_PrimaryBlue_06,
        PROJECT_ITEM_SECTION_HEADER: '#E6F3FF',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_PrimaryBlue_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_PrimaryBlue_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_PrimaryBlue_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_PrimaryBlue_02,
    },
    [PROJECT_COLOR_BLUE]: {
        MARKER: Colors.Marker_Blue_01,
        MARKER_TEXT: Colors.Marker_Blue_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Blue_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Blue_06,
        PROJECT_ITEM_SECTION_HEADER: '#EBF8FA',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Blue_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Blue_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Blue_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Blue_02,
    },
    [PROJECT_COLOR_RED]: {
        MARKER: Colors.Marker_Red_01,
        MARKER_TEXT: Colors.Marker_Red_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Red_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Red_06,
        PROJECT_ITEM_SECTION_HEADER: '#FAEBEE',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Red_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Red_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Red_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Red_02,
    },
    [PROJECT_COLOR_PURPLE]: {
        MARKER: Colors.Marker_Purple_01,
        MARKER_TEXT: Colors.Marker_Purple_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Purple_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Purple_06,
        PROJECT_ITEM_SECTION_HEADER: '#F5EDFB',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Purple_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Purple_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Purple_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Purple_02,
    },
    [PROJECT_COLOR_GREEN]: {
        MARKER: Colors.Marker_Green_01,
        MARKER_TEXT: Colors.Marker_Green_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Green_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Green_06,
        PROJECT_ITEM_SECTION_HEADER: '#ECFAF3',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Green_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Green_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Green_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Green_02,
    },
    [PROJECT_COLOR_PINK]: {
        MARKER: Colors.Marker_Pink_01,
        MARKER_TEXT: Colors.Marker_Pink_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Pink_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Pink_06,
        PROJECT_ITEM_SECTION_HEADER: '#FAEBF2',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Pink_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Pink_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Pink_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Pink_02,
    },
    [PROJECT_COLOR_ORANGE]: {
        MARKER: Colors.Marker_Orange_01,
        MARKER_TEXT: Colors.Marker_Orange_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Orange_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Orange_06,
        PROJECT_ITEM_SECTION_HEADER: '#FAF0EB',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Orange_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Orange_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Orange_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Orange_02,
    },
    [PROJECT_COLOR_YELLOW]: {
        MARKER: Colors.Marker_Yellow_01,
        MARKER_TEXT: Colors.Marker_Yellow_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Yellow_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Yellow_06,
        PROJECT_ITEM_SECTION_HEADER: '#F8F6E1',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Yellow_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Yellow_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Yellow_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Yellow_02,
    },
    [PROJECT_COLOR_PELOROUS]: {
        MARKER: Colors.Marker_Pelorous_01,
        MARKER_TEXT: Colors.Marker_Pelorous_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Pelorous_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Pelorous_06,
        PROJECT_ITEM_SECTION_HEADER: '#EBFAF6',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Pelorous_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Pelorous_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Pelorous_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Pelorous_02,
    },
    [PROJECT_COLOR_LIME]: {
        MARKER: Colors.Marker_Lime_01,
        MARKER_TEXT: Colors.Marker_Lime_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Lime_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Lime_06,
        PROJECT_ITEM_SECTION_HEADER: '#F6FAEB',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Lime_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Lime_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Lime_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Lime_02,
    },
    [PROJECT_COLOR_VIOLET]: {
        MARKER: Colors.Marker_Violet_01,
        MARKER_TEXT: Colors.Marker_Violet_Dark,
        PROJECT_ITEM: Colors.GraySidebar,
        PROJECT_ITEM_ACTIVE: Colors.Marker_Violet_03,
        PROJECT_ITEM_SECTION: Colors.Marker_Violet_06,
        PROJECT_ITEM_SECTION_HEADER: '#ECEBFA',
        PROJECT_ITEM_SECTION_ACTIVE: Colors.Marker_Violet_02,
        PROJECT_ITEM_SECTION_SELECTED: Colors.Marker_Violet_025,
        PROJECT_ITEM_SECTION_ITEM: Colors.Marker_Violet_04,
        PROJECT_ITEM_SECTION_ITEM_ACTIVE: Colors.Marker_Violet_02,
    },
}

// The project tints are display-only backgrounds: in dark mode they become dark tints of the
// same hue (Themes/colorMode.js). MARKER (the saturated project color) and MARKER_TEXT stay hex.
const ADAPTIVE_KEYS = [
    'PROJECT_ITEM_ACTIVE',
    'PROJECT_ITEM_SECTION',
    'PROJECT_ITEM_SECTION_HEADER',
    'PROJECT_ITEM_SECTION_ACTIVE',
    'PROJECT_ITEM_SECTION_SELECTED',
    'PROJECT_ITEM_SECTION_ITEM',
    'PROJECT_ITEM_SECTION_ITEM_ACTIVE',
]

// Lines and fills that carry structure on the project card (the frame around a goal and its tasks,
// the goal progress bar). The adaptive dark tints above are meant to be quiet backgrounds: on the
// dark card the frame of a violet project came out at 1.05:1 and was invisible, a blue one at 1.5:1.
// In dark mode these are therefore mixed from the project's own colour to one fixed contrast against
// the card, so every project colour reads the same. Light mode keeps the pastels.
export const PROJECT_DARK_BORDER_CONTRAST = 2
export const PROJECT_DARK_GOAL_BAR_CONTRAST = 1.3

// The percentage box itself: white in light mode; in dark mode it sits on its row instead of being
// a darker hole in it.
export const GOAL_BOX_BACKGROUND = modeColor('#FFFFFF', 'transparent')

export const PROJECT_COLOR_SYSTEM = Object.fromEntries(
    Object.entries(PROJECT_COLOR_SYSTEM_HEX).map(([key, system]) => {
        const adapted = { ...system, PROJECT_ITEM: themed.GraySidebar }
        ADAPTIVE_KEYS.forEach(name => {
            adapted[name] = adaptiveColor(system[name])
        })
        const darkCard = getHighlightDisplayColor(system.PROJECT_ITEM_SECTION, COLOR_MODE_DARK)
        adapted.PROJECT_ITEM_SECTION_BORDER = modeColor(
            system.PROJECT_ITEM_SECTION_ACTIVE,
            tintForContrast(system.MARKER, darkCard, PROJECT_DARK_BORDER_CONTRAST)
        )
        adapted.PROJECT_GOAL_BAR = modeColor(
            system.PROJECT_ITEM_ACTIVE,
            tintForContrast(system.MARKER, darkCard, PROJECT_DARK_GOAL_BAR_CONTRAST)
        )
        // The empty percentage box on a goal row (GoalProgress at 0%, the "General tasks" stand-in).
        // Its pastel border would be a dark tint the size of the row behind it, so the box read as
        // an empty hole: draw it from the project colour instead.
        adapted.PROJECT_GOAL_BOX_BORDER = modeColor(
            system.PROJECT_ITEM_SECTION_ITEM_ACTIVE,
            alphaColor(system.MARKER, 0.6)
        )
        return [key, adapted]
    })
)
