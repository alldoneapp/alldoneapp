import { COLORS_THEME_DEFAULT, COLORS_THEME_MODERN, getTheme } from '../../../Themes/Themes'
import theme_modern from './theme_modern'
import theme_default from './theme_default'

export const Themes = {
    [COLORS_THEME_DEFAULT]: theme_default,
    [COLORS_THEME_MODERN]: theme_modern,
}

export const getUserItemTheme = themeName => {
    return getTheme(
        Themes,
        themeName,
        'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.ProjectSectionItem.SectionItemLayout.UserItem'
    )
}
