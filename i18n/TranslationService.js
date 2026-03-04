import * as Localization from 'expo-localization'
import { useSelector } from 'react-redux'
import { useEffect, useState } from 'react'

import i18n from 'i18n-js'
import en from './translations/en.json'
import es from './translations/es.json'
import de from './translations/de.json'

i18n.fallbacks = true
i18n.translations = { en, es, de }
i18n.defaultLocale = 'en'

export function getDeviceLanguage() {
    switch (true) {
        case Localization.locale.includes('en'):
            return 'en'
        case Localization.locale.includes('es'):
            return 'es'
        case Localization.locale.includes('de'):
            return 'de'
        default:
            return 'en'
    }
}

i18n.locale = getDeviceLanguage()

export function getUserLanguageIndexForSendinBlue() {
    const options = { de: '1', en: '2', es: '3', fr: '4' }
    if (Localization.locale.includes('de')) return options['de']
    if (Localization.locale.includes('en')) return options['en']
    if (Localization.locale.includes('es')) return options['es']
    if (Localization.locale.includes('fr')) return options['fr']
    return options['en']
}

const getNormalizedLanguage = language => String(language || '').split(/[-_]/)[0]

const getTranslationOptions = language => {
    const normalizedLanguage = getNormalizedLanguage(language)
    return [
        normalizedLanguage,
        getNormalizedLanguage(i18n.defaultLocale),
        getNormalizedLanguage(getDeviceLanguage()),
    ].filter(Boolean)
}

const getExactTranslation = textKey => {
    const languages = getTranslationOptions(i18n.locale)

    for (const language of languages) {
        const translation = i18n.translations?.[language]?.[textKey]
        if (translation !== undefined) return translation
    }

    return null
}

export const translate = (textKey = '', interpolations = {}) => {
    const exactTranslation = getExactTranslation(textKey)
    if (exactTranslation !== null) return i18n.interpolate(exactTranslation, interpolations)

    return i18n.t(textKey, interpolations)
}

export const useTranslator = () => {
    const language = useSelector(state => state.loggedUser.language)
    const [flag, setFlag] = useState(false)

    useEffect(() => {
        if (language !== i18n.locale) {
            i18n.locale = language
        }
        setFlag(state => !state)
    }, [language])

    return null
}

export const setLanguage = language => {
    i18n.locale = language
}
