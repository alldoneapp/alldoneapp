import moment from 'moment'
import i18n from 'i18n-js'

// Moment's locale files select a global default when loaded. Register only our
// supported locales, then restore that default: legacy callers parse English
// fromNow() output, so changing it globally would break them.
const defaultLocale = moment.locale()
require('moment/locale/de')
require('moment/locale/es')
moment.locale(defaultLocale)

export const localizedMoment = date => {
    const language = String(i18n.locale || '').split(/[-_]/)[0]
    return moment(date).locale(['de', 'es'].includes(language) ? language : 'en')
}
