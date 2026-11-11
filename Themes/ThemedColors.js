import Colors from './Colors'
import { themed } from './colorMode'

/**
 * Display version of Themes/Colors.js for UI that should follow light/dark mode (the light
 * "modern" sidebar and top bar). Neutrals and pastel tints become palette tokens; accents,
 * markers and White (text on colored buttons) keep their hex values. Never store a value
 * from here: Themes/Colors.js stays the palette for persisted colors.
 */
const ThemedColors = {
    ...Colors,
    Surface: themed.Surface,
    GraySidebar: themed.GraySidebar,
    WhiteGray: themed.WhiteGray,
    Text01: themed.Text01,
    Text02: themed.Text02,
    Text03: themed.Text03,
    Text04: themed.Text04,
    Grey100: themed.Grey100,
    Grey200: themed.Grey200,
    Grey300: themed.Grey300,
    Grey350: themed.Grey350,
    Grey400: themed.Grey400,
    SecondaryButton: themed.SecondaryButton,
    SecondaryButton_Pressed: themed.SecondaryButton_Pressed,
    SecondaryButton_Focus: themed.SecondaryButton_Focus,
    SecondaryButton_Default_Occlusion: themed.SecondaryButton_Default_Occlusion,
    Marker_PrimaryBlue_03: themed.SidebarSelected,
    UtilityBlue100: themed.UtilityBlue100,
    UtilityBlue112: themed.UtilityBlue112,
    UtilityBlue125: themed.UtilityBlue125,
    UtilityGreen100: themed.UtilityGreen100,
    UtilityGreen112: themed.UtilityGreen112,
    UtilityGreen125: themed.UtilityGreen125,
    UtilityYellow100: themed.UtilityYellow100,
    UtilityYellow112: themed.UtilityYellow112,
    UtilityYellow125: themed.UtilityYellow125,
    UtilityRed100: themed.UtilityRed100,
    UtilityRed112: themed.UtilityRed112,
    UtilityRed125: themed.UtilityRed125,
    UtilityViolet100: themed.UtilityViolet100,
    UtilityViolet112: themed.UtilityViolet112,
    UtilityViolet125: themed.UtilityViolet125,
}

export default ThemedColors
