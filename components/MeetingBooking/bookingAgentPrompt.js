import { translate } from '../../i18n/TranslationService'
import { getAppLinkOrigin } from '../../utils/LinkingHelper'

// AT-3161: the visible "Book with your AI agent" hint on a public booking page. The prompt names
// this page's own address (the origin the page runs on, the host's canonical slug), never a fixed
// example host, so a copy from staging or a local build points the agent at that same page.
export const getBookingPageUrl = (slug, origin = getAppLinkOrigin()) => {
    const cleanOrigin = String(origin || '').replace(/\/+$/, '')
    return `${cleanOrigin}/meet/${encodeURIComponent(String(slug || '').trim())}`
}

// In the page's current language; the agent reads whatever the visitor pastes.
export const buildBookingAgentPrompt = url => translate('Booking agent prompt', { url })

const copyWithTextArea = text => {
    if (typeof document === 'undefined' || !document.body) return false
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.top = '0'
    textArea.style.left = '0'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    let copied = false
    try {
        copied = document.execCommand('copy') === true
    } catch (error) {
        copied = false
    }
    document.body.removeChild(textArea)
    return copied
}

/**
 * Copies text and says whether it worked, so the page only reports "Copied" when it did.
 * `copyTextToClipboard` in HelperFunctions swallows a refused write, which is fine for a link
 * button but would claim success here. Call it inside the click: the clipboard needs the gesture.
 */
export const copyBookingText = async text => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
    if (clipboard && typeof clipboard.writeText === 'function') {
        try {
            await clipboard.writeText(text)
            return true
        } catch (error) {
            // Permission refused or an insecure context: try the old way before giving up.
        }
    }
    return copyWithTextArea(text)
}
