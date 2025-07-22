import { BREAKLINE_CODE, REGEX_BOT_BOLD, REGEX_BOT_CODE } from '../../../Feeds/Utils/HelperFunctions'

export const divideCodeText = comment => {
    const textWithoutBreaks = comment.replaceAll('\n', BREAKLINE_CODE)
    const results = []
    let current
    while ((current = REGEX_BOT_CODE.exec(textWithoutBreaks))) {
        results.push(current)
    }

    const textData = results.length > 0 ? [] : [{ type: 'normal', text: comment }]
    let textStart = 0
    results.forEach((result, index) => {
        const codeText = result[1]
        const codeStart = result.index

        if (textStart !== codeStart) {
            textData.push({
                type: 'normal',
                text: textWithoutBreaks.substring(textStart, codeStart).replaceAll(BREAKLINE_CODE, '\n'),
            })
        }
        textData.push({ type: 'code', text: codeText.replaceAll(BREAKLINE_CODE, '\n') })
        textStart = codeStart + codeText.length + 3 + 3
        if (index === results.length - 1 && textStart !== textWithoutBreaks.length) {
            textData.push({
                type: 'normal',
                text: textWithoutBreaks.substring(textStart, textWithoutBreaks.length).replaceAll(BREAKLINE_CODE, '\n'),
            })
        }
    })

    return textData
}

export const divideBoldText = comment => {
    const textWithoutBreaks = comment.replaceAll('\n', BREAKLINE_CODE)

    const results = []
    let current
    while ((current = REGEX_BOT_BOLD.exec(textWithoutBreaks))) {
        results.push(current)
    }

    const textData = results.length > 0 ? [] : [{ type: 'normal', text: comment }]
    let textStart = 0
    results.forEach((result, index) => {
        const boldText = result[1]
        const boldStart = result.index
        if (textStart !== boldStart) {
            textData.push({
                type: 'normal',
                text: textWithoutBreaks.substring(textStart, boldStart).replaceAll(BREAKLINE_CODE, '\n'),
            })
        }
        textData.push({ type: 'bold', text: boldText.replaceAll(BREAKLINE_CODE, '\n') })
        textStart = boldStart + boldText.length + 2 + 2
        if (index === results.length - 1 && textStart !== textWithoutBreaks.length) {
            textData.push({
                type: 'normal',
                text: textWithoutBreaks.substring(textStart, textWithoutBreaks.length).replaceAll(BREAKLINE_CODE, '\n'),
            })
        }
    })

    return textData
}
