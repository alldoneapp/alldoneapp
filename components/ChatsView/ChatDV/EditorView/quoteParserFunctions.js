export const divideQuotedText = (comment, keyWord) => {
    let texts = comment.trim().split(`[${keyWord}]`)

    const textsFiltered = []

    if (texts.length <= 2) {
        textsFiltered.push({ type: 'normal', text: comment.replaceAll(`[${keyWord}]`, '').trim() })
        return textsFiltered
    }

    texts.forEach((text, index) => {
        if (text !== '') {
            if (index % 2 === 0 || index === texts.length - 1) {
                if (textsFiltered[index - 1] && textsFiltered[index - 1].type === 'normal') {
                    textsFiltered[index - 1].text += ' ' + text.trim()
                } else {
                    textsFiltered.push({ type: 'normal', text: text.trim() })
                }
            } else {
                textsFiltered.push({ type: `${keyWord}`, text: text.trim() })
            }
        }
    })
    return textsFiltered
}
