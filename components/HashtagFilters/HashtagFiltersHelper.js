
/**
 * Replace all characters with diacritics with simple characters
 * @param text
 * @returns {*}
 */

export const normalizeDiacriticsText = text => {
    return text != null ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ''
}

/**
 * Determine if target text match a term list
 *
 * @param targetText
 * @param termList
 * @returns {boolean}
 */
export const matchSearch = (targetText, termList) => {
    targetText = normalizeDiacriticsText(targetText)

    for (let term of termList) {
        term = normalizeDiacriticsText(term).replace(/[-\/.*+?^${}()|[\]\\]/g, '\\$&')
        let regex = new RegExp(term, 'i')

        if (term !== '' && !regex.test(targetText)) {
            return false
        }
    }

    return true
}
