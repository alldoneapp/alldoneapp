export const getShortExternalUrlText = (title = '', textLimit = Infinity) => {
    const firstSlash = title.indexOf('/')
    const firstQuestion = title.indexOf('?')
    const firstHash = title.indexOf('#')
    const splitIndex = [firstSlash, firstQuestion, firstHash].filter(index => index > -1).sort((a, b) => a - b)[0]
    const baseText = splitIndex > -1 ? title.substr(0, splitIndex) : title
    const hasExtraUrlParts = /[/?#]/.test(title)

    return hasExtraUrlParts || title.length >= textLimit ? `${baseText}...` : baseText
}
