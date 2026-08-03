import MyPlatform from '../../MyPlatform'

export const shouldAutoFocusTaskInput = (adding, smallScreenNavigation) =>
    !adding || (!smallScreenNavigation && !MyPlatform.isMobile)
