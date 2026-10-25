import { getUrlTokenParts } from '../components/Feeds/Utils/linkDetection'

/**
 * AT-2470 — a URL nested inside an OBJECT TITLE renders as the readable path, never as
 * the literal placeholder `LINK`.
 *
 * `handleNestedLinks` runs on the title of a linked object right before that title is
 * drawn inside a chip: task tags in notes (`TaskTag`), link tags (`LinkTag`), backlink
 * tags (`BacklinksTag`) and the URL embed blot of the rich editor
 * (`autoformat/formats/url.js`). Until AT-2470 every URL-looking word was replaced by
 * the string `'LINK '`, which failed in two directions at once.
 *
 * It was WRONG FOR REAL URLS: the chip renders into a plain `<Text numberOfLines={1}>`
 * and there is no `title` attribute or tooltip anywhere in `LinkTag`, so once a title
 * collapsed to `LINK` the destination was unrecoverable from the UI — two chips
 * pointing at different places became indistinguishable.
 *
 * And it was WRONG FOR ORDINARY WORDS, which is why the report says "sometimes": the
 * detector was the bare `REGEX_URL`, whose third alternative is
 * `[\S]+\.[a-zA-Z]{2,}[\S]*`, i.e. ANY word carrying a dot followed by two or more
 * letters. `package.json`, `Node.js`, `README.md`, `deploy.sh`, `Dr.Smith`, `St.Pauli`
 * and German prose that omits the space after a full stop (`Fertig.Bitte`) all matched,
 * so "Update package.json" was displayed as "Update LINK".
 *
 * The substitution bought nothing it was named for. These labels are plain text, so
 * there is no nested anchor to prevent, and nothing in the codebase ever compared
 * against the string `'LINK'` — it was purely cosmetic.
 *
 * Three rules make the replacement safe:
 *
 * 1. Only a token carrying an EXPLICIT `http(s)://` / `ftp://` scheme or a `www.`
 *    prefix is rewritten. A bare `word.tld` is left byte-identical — that single rule
 *    retires the whole false-positive class above, and it costs nothing for genuine
 *    bare domains (`crew.ai`), which are already the readable form of themselves.
 *
 * 2. Detection goes through `getUrlTokenParts`, the strict guard the rest of the app
 *    uses (`isDetectedUrl` = `REGEX_URL_START` AND `REGEX_URL`), rather than the loose
 *    `REGEX_URL` alone. It also splits off wrapping brackets and trailing punctuation,
 *    so `(https://example.com/a).` keeps its `(` and `).`.
 *
 * 3. The output FORMAT matches `getDomain` in `components/Tags/LinkTag.js` — host, path,
 *    query and hash, with the scheme and a leading `www.` dropped — but it is produced
 *    by STRING SLICING rather than by calling that helper. Two reasons, and both are
 *    load-bearing. `getDomain` builds its result out of `new URL()`, whose `hostname`
 *    is LOWERCASED (`new URL('https://Dr.Smith').hostname` is `dr.smith`), so routing a
 *    title through it would silently mangle the casing of the very text this function
 *    exists to preserve. And `LinkTag` imports `handleNestedLinks` from `LinkingHelper`,
 *    so importing `getDomain` back the other way would close an import cycle.
 */

const URL_SCHEME_PREFIX = /^(?:https?|ftp):\/\//i
const URL_WWW_PREFIX = /^www\./i

const hasExplicitUrlPrefix = url => URL_SCHEME_PREFIX.test(url) || URL_WWW_PREFIX.test(url)

/**
 * `https://www.gitlab.com/group/repo/-/merge_requests/42/`
 *   -> `gitlab.com/group/repo/-/merge_requests/42`
 *
 * Keeps the path, the query and the hash, because those are what tell two links to the
 * same host apart. Only the scheme, a leading `www.` and trailing slashes are dropped.
 */
export const toReadableUrlText = url => {
    const safeUrl = String(url)
    const readable = safeUrl.replace(URL_SCHEME_PREFIX, '').replace(URL_WWW_PREFIX, '').replace(/\/+$/, '')

    // A URL that is nothing but its scheme cannot reach here through `getUrlTokenParts`,
    // but never render an empty label if it ever does.
    return readable || safeUrl
}

const toReadableToken = token => {
    const urlParts = getUrlTokenParts(token)
    if (!urlParts) return token

    // A bare `word.tld` is already the proper path. Leaving it untouched is what keeps
    // `package.json`, `README.md` and `Dr.Smith` out of this code path entirely.
    if (!hasExplicitUrlPrefix(urlParts.url)) return token

    return `${urlParts.prefix}${toReadableUrlText(urlParts.url)}${urlParts.suffix}`
}

/**
 * Rewrites the URLs inside a title so a chip shows the readable path.
 *
 * Whitespace runs are preserved verbatim (the split keeps its separators), matching the
 * previous implementation's handling of repeated spaces, and the result is trimmed as
 * before. Splitting on all whitespace rather than only `' '` additionally means a URL
 * that follows a newline is now recognised.
 */
export const handleNestedLinks = text => {
    // The URL blot resolves its label asynchronously and can hand us `undefined`
    // (`autoformat/formats/url.js`); that used to throw inside a Backend callback.
    if (text === null || text === undefined) return ''

    return String(text)
        .split(/(\s+)/)
        .map(token => (token === '' || /^\s+$/.test(token) ? token : toReadableToken(token)))
        .join('')
        .trim()
}
