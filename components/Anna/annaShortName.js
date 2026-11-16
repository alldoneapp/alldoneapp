/**
 * AT-3056: the phone's chat header shows the assistant by a short name, so the focus task in the
 * middle of the row keeps the room ("Anna" for "Anna Alldone"). It is the first word of the name;
 * a first word of one or two letters ("AI Coach", "Dr X") says too little alone, so the second word
 * stays with it. A single long word is cut off by CSS (`.anna-header-phone .anna-brand`). Callers
 * keep the full name in the accessible label and the title.
 */
export const getAnnaShortName = (name = '') => {
    const words = `${name || ''}`.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return ''
    if (words[0].length <= 2 && words.length > 1) return `${words[0]} ${words[1]}`
    return words[0]
}
