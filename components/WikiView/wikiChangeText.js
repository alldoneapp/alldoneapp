import { translate } from '../../i18n/TranslationService'

export function quoteWikiPageTitle(title) {
    return translate('Wiki page quoted', { title })
}

// "Karsten corrected the page “Customers”" — the line a wiki change gets in the Updates feed and at
// the top of its change view. `name` is whoever made it, or the wiki itself for an ingest run.
export function describeWikiChange(kind, name, pageTitle) {
    return translate(`Wiki change ${kind}`, { name, page: quoteWikiPageTitle(pageTitle) })
}
