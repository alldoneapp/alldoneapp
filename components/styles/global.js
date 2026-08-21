import { Dimensions } from 'react-native'
import MyPlatform from '../MyPlatform'

export const em2px = em => {
    const base = 1 / 16
    const px = em / base

    return px
}

/**
 * Convert a hexadecimal color to RGBa
 * @param hexColor
 * @param alpha
 * @returns {string}
 */
export const hexColorToRGBa = (hexColor, alpha) => {
    hexColor = hexColor.replace('#', '')
    let r = parseInt(hexColor.length === 3 ? hexColor.slice(0, 1).repeat(2) : hexColor.slice(0, 2), 16)
    let g = parseInt(hexColor.length === 3 ? hexColor.slice(1, 2).repeat(2) : hexColor.slice(2, 4), 16)
    let b = parseInt(hexColor.length === 3 ? hexColor.slice(2, 3).repeat(2) : hexColor.slice(4, 6), 16)
    if (alpha) {
        return `rgba(${r},${g},${b},${alpha})`
    } else {
        return `rgb(${r},${g},${b})`
    }
}

export const windowTagStyle = () => {
    const { osType, browserType } = MyPlatform
    if (osType === 'windows' && (browserType === 'edge' || browserType === 'chrome')) {
        return { paddingTop: 1 }
    }
}

export const sideMenuLabelColor = 'rgb(108,143,201)'
export const tasksViewLabelColor = '#8A94A6'

export const colors = {
    funnyWhite: hexColorToRGBa('#FFFFFF', 0.2),

    UtilityRed100: '#FFEBEB',
    UtilityRed112: '#FFD6D6',
    UtilityRed125: '#FFC7C7',
    UtilityRed150: '#FFA3A3',
    UtilityRed200: '#E00000',
    UtilityRed300: '#BD0303',

    UtilityBlue100: '#EBF5FF',
    UtilityBlue112: '#D6EBFF',
    UtilityBlue125: '#C7E3FF',
    UtilityBlue150: '#A3D1FF',
    UtilityBlue200: '#5AACFF',
    UtilityBlue300: '#0070E0',

    UtilityDarkBlue125: '#D6E3FF',
    UtilityDarkBlue300: '#0055FF',

    UtilityGreen100: '#EAFFF8',
    UtilityGreen112: '#C7F5E5',
    UtilityGreen125: '#ADF0D9',
    UtilityGreen150: '#7BEAC5',
    UtilityGreen200: '#00C282',
    UtilityGreen300: '#07A873',

    UtilityYellow100: '#FFF6EB',
    UtilityYellow112: '#FFEDD6',
    UtilityYellow125: '#FFE6C7',
    UtilityYellow150: '#FFCE8F',
    UtilityYellow200: '#FFAE47',
    UtilityYellow300: '#F58E0A',

    UtilityLime100: '#F0F3CE',
    UtilityLime112: '#EAF0AF',
    UtilityLime125: '#E0EA80',
    UtilityLime150: '#CCDA49',
    UtilityLime200: '#B5C200',
    UtilityLime300: '#A8A700',

    UtilityOrange100: '#FFE8E0',
    UtilityOrange112: '#FFE0D6',
    UtilityOrange125: '#FFD4C7',
    UtilityOrange150: '#FFB59E',
    UtilityOrange200: '#FF7043',
    UtilityOrange300: '#E64A19',
    UtilityOrange400: '#FFC887',

    UtilityViolet100: '#ECE0FF',
    UtilityViolet112: '#E5D6FF',
    UtilityViolet125: '#DBC7FF',
    UtilityViolet150: '#A16BFF',
    UtilityViolet200: '#8743FF',
    UtilityViolet300: '#702EE6',

    Green125: '#ADF0D9',
    Green300: '#07A873',
    Green400: '#057651',
    Yellow300: '#F58E0A',
    Yellow400: '#A66007',
    Yellow112: '#FFEDD6',
    Yellow125: '#FFE6C7',
    Violet125: '#DBC7FF',
    Violet150: '#A16BFF',
    Violet300: '#702EE6',
    Grey100: '#FAFBFB',
    Grey200: '#F1F3F4',
    Grey300: '#E7ECEF',
    Grey400: '#C6CDD2',
    Grey500: '#F7F7F7',
    Red200: '#E00000',
    Text01: '#04142F',
    Text02: '#4E5D78',
    Text03: '#8A94A6',
    Text04: '#B7BDC8',
    Gray200: '#F1F3F4',
    Gray300: '#E7ECEF',
    Gray400: '#C6CDD2',
    Gray500: '#718592',
    Secondary100: '#4F66BA',
    Secondary200: '#1A3289',
    Secondary250: '#172C78',
    Secondary300: '#152560',
    Secondary400: '#091540',
    SecondaryButton: '#EAF0F5',
    Primary100: '#007FFF',
    Primary200: '#0C66FF',
    Primary300: '#0D55CF',
    Primary350: '#0C4DBB',
    Primary400: '#0A44A5',
    ProjectColor100: '#06EEC1',
    ProjectColor200: '#E17055',
    ProjectColor300: '#7F71EA',
    ProjectColor400: '#00CEC9',
    ProjectColor500: '#FDCB6E',
    ProjectColor600: '#1DE686',
    ProjectColor700: '#FB70A1',
    ProjectColor800: '#45AFFC',
    ProjectColor900: '#B4E44E',
    ProjectColor1000: '#E06EFD',
    UtilityBlue: '#EBF5FF',
}

export const collabColors = [
    '#e57373',
    '#ef5350',
    '#ff1744',
    '#d50000',
    '#f06292',
    '#ec407a',
    '#ff4081',
    '#f50057',
    '#ba68c8',
    '#ab47bc',
    '#e040fb',
    '#d500f9',
    '#b39ddb',
    '#9575cd',
    '#7e57c2',
    '#7c4dff',
    '#651fff',
    '#9fa8da',
    '#7986cb',
    '#536dfe',
    '#3d5afe',
    '#90caf9',
    '#64b5f6',
    '#448aff',
    '#2979ff',
    '#81d4fa',
    '#4fc3f7',
    '#40c4ff',
    '#00b0ff',
    '#80deea',
    '#4dd0e1',
    '#18ffff',
    '#00e5ff',
    '#80cbc4',
    '#4db6ac',
    '#64ffda',
    '#1de9b6',
    '#a5d6a7',
    '#81c784',
    '#69f0ae',
    '#00e676',
    '#c5e1a5',
    '#aed581',
    '#b2ff59',
    '#76ff03',
    '#e6ee9c',
    '#dce775',
    '#eeff41',
    '#c6ff00',
    '#fff59d',
    '#fff176',
    '#ffff00',
    '#ffea00',
    '#ffe082',
    '#ffd54f',
    '#ffd740',
    '#ffc400',
    '#ffcc80',
    '#ffb74d',
    '#ffab40',
    '#ff9100',
    '#ffab91',
    '#ff8a65',
    '#ff6e40',
    '#ff3d00',
    '#bcaaa4',
    '#a1887f',
]

export const POPOVER_TABLET_WIDTH_V2 = 558
export const POPOVER_DESKTOP_WIDTH_V2 = 758

export const POPOVER_MOBILE_WIDTH = 304
export const POPOVER_TABLET_WIDTH = 368
export const POPOVER_DESKTOP_WIDTH = 432
export const SIDEBAR_MENU_WIDTH = 263
export const SIDEBAR_MENU_COLLAPSED_WIDTH = 56
export const SCREEN_BREAKPOINT_MIDDLE = 1052
export const SCREEN_BREAKPOINT = 970
export const SCREEN_BREAKPOINT_NAV = 818
export const SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED = 611
export const SCREEN_SMALL_BREAKPOINT_NAV = 459

export const isSmallScreen = () => Dimensions.get('window').width < SCREEN_BREAKPOINT
export const getRandomCollabColor = () => collabColors[Math.floor(Math.random() * (collabColors.length - 1))]

const styles = {
    title1: {
        fontFamily: 'Roboto-Regular',
        fontSize: 56,
        lineHeight: 64,
        color: '#04142F',
    },
    title2: {
        fontFamily: 'Roboto-Medium',
        fontSize: 40,
        lineHeight: 48,
        color: '#04142F',
    },
    title3: {
        fontFamily: 'Roboto-Medium',
        fontSize: 32,
        lineHeight: 40,
        color: '#04142F',
    },
    title4: {
        fontFamily: 'Roboto-Medium',
        fontSize: 24,
        lineHeight: 32,
        color: '#04142F',
    },
    title5: {
        fontFamily: 'Roboto-Regular',
        fontSize: 24,
        lineHeight: 32,
    },
    title6: {
        fontFamily: 'Roboto-Medium',
        fontSize: 20,
        lineHeight: 28,
        color: '#04142F',
    },
    title7: {
        fontFamily: 'Roboto-Medium',
        fontSize: 18,
        lineHeight: 26,
        color: '#04142F',
    },
    subtitle1: {
        fontFamily: 'Roboto-Medium',
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: em2px(0.01),
    },
    subtitle2: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 22,
        letterSpacing: em2px(0.01),
        color: '#04142F',
    },
    body1: {
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: em2px(0.02),
        color: '#04142F',
    },
    body2: {
        fontFamily: 'Roboto-Regular',
        fontSize: 14,
        lineHeight: 22,
        letterSpacing: em2px(0.02),
        color: '#04142F',
    },
    body3: {
        fontFamily: 'Roboto-Regular',
        fontSize: 11,
        lineHeight: 20,
        letterSpacing: em2px(0.03),
        color: '#8A94A6',
    },
    caption1: {
        fontFamily: 'Roboto-Medium',
        fontSize: 12,
        lineHeight: 20,
        letterSpacing: em2px(0.03),
        color: '#04142F',
    },
    caption2: {
        fontFamily: 'Roboto-Regular',
        fontSize: 12,
        lineHeight: 20,
        letterSpacing: em2px(0.03),
        color: '#04142F',
    },
    overline: {
        fontFamily: 'Roboto-Regular',
        fontSize: 11,
        lineHeight: 20,
        letterSpacing: 1.5,
        color: '#04142F',
    },
    overlineNormal: {
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        lineHeight: 22,
        letterSpacing: 0.5,
        fontWeight: 700,
        color: '#FFF',
    },
    button: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
        color: '#04142F',
    },
    buttonLabel: {
        fontFamily: 'Roboto-Medium',
        fontStyle: 'normal',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
    masterButton: {
        fontFamily: 'Roboto-Medium',
        fontSize: 24,
        lineHeight: 32,
        color: '#04142F',
    },
    inactiveWhite: {
        color: 'white',
        opacity: 0.8,
    },
    activeWhite: {
        color: 'white',
    },
    inactiveGray: {
        color: '#C6CDD2',
    },
    inactiveGray2: {
        color: '#8A94A6',
    },
    impressumText: {
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: em2px(0.02),
        color: colors.Text01,
    },
    indicatorText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: 'bold',
        fontSize: 9,
        lineHeight: 10,
        color: '#ffffff',
    },
}

export default styles
