import store from '../redux/store'

class SearchHelper {
    /**
     * Replace all characters with diacritics with dimple characters
     * @param text
     * @returns {*}
     */
    static normalizeDiacriticsText = text => {
        return text !== undefined ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ''
    }

    static matchSearch(targetText, searchText) {
        const { searchText: stateSearchText } = store.getState()
        let termList = SearchHelper.normalizeDiacriticsText(searchText || stateSearchText).split(' ')
        targetText = SearchHelper.normalizeDiacriticsText(targetText)

        for (let term of termList) {
            term = term.replace(/[-\/.*+?^${}()|[\]\\]/g, '\\$&')
            let regex = new RegExp(term, 'i')

            if (term !== '' && !regex.test(targetText)) {
                return false
            }
        }

        return true
    }
}

export const isSearch = () => {
    const { activeSearchForm, searchText } = store.getState()
    return activeSearchForm && searchText !== ''
}

export default SearchHelper
