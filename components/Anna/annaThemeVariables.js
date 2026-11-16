import { colors } from '../styles/global'
import { themed } from '../../Themes/colorMode'

// The custom properties anna.css reads. AnnaShell sets them on its root; a surface that reuses
// Anna's styles outside the shell (the main app's floating call panel, AT-3038) sets the same
// ones, so both follow light and dark mode through the same tokens.
export const ANNA_THEME_VARIABLES = {
    '--anna-ink': colors.Text01,
    '--anna-muted': colors.Text02,
    '--anna-placeholder': colors.Text03,
    '--anna-accent': colors.Primary200,
    // Blue text that reads on both surfaces (activity card labels, AT-3046).
    '--anna-accent-text': themed.AccentText,
    '--anna-unread': colors.UtilityRed200,
    '--anna-neutral': colors.Grey200,
    '--anna-tint': colors.UtilityBlue100,
    '--anna-hover': colors.UtilityBlue112,
    '--anna-border': colors.Grey300,
    '--anna-bezel': colors.Grey400,
    '--anna-focus': colors.UtilityBlue150,
    '--anna-surface': colors.Grey100,
}
