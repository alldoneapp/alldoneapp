import { isCapacitorShell } from './CapacitorShell'

// These assets ship with the web app, including the local dev server. Native accounts
// need a public URL rather than the shell's capacitor://localhost origin.
export const getDefaultProfilePhotoURL = (assistant = false) => {
    const location = typeof window === 'undefined' ? null : window.location
    const origin =
        location && ['http:', 'https:'].includes(location.protocol) && !isCapacitorShell()
            ? location.origin
            : 'https://my.alldone.app'
    return `${origin}/${assistant ? 'images/illustrations/AnnaAlldone.png' : 'images/generic-user.svg'}`
}
