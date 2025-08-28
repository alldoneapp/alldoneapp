const HASHTAG_MAIN_COLORS = [
    '#BD0303', // UtilityRed300,
    '#F58E0A', // UtilityYellow300,
    '#07A873', // UtilityGreen300,
    '#0070E0', // UtilityBlue300,
    '#702EE6', // UtilityViolet300,
]

const matchAnyColor = (value, getColor) => {
    const chunks = value.split('#')
    const possibleColor = `#${chunks[chunks.length - 1]}`
    const match = HASHTAG_MAIN_COLORS.includes(possibleColor)

    return getColor ? (match ? possibleColor : '#702EE6') : match
}

const removeColor = text => {
    if (matchAnyColor(text)) {
        const chunks = text.split('#')
        chunks.splice(chunks.length - 1, 1)
        text = chunks.join('#')
    }

    return text
}

module.exports = {
    removeColor,
    matchAnyColor,
}
