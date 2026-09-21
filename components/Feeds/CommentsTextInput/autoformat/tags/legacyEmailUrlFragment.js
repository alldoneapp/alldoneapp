const EMAIL_LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i
const EMAIL_DOMAIN_PART = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i
const EMAIL_PREFIX_BEFORE_DOMAIN = /@[a-z0-9.-]*$/i

export const shouldRenderAsLegacyEmailText = (url, previousText = '', nextText = '') => {
    if (!url || /^(?:https?|ftp):\/\//i.test(url)) return false

    const isLocalPartBeforeAtSign = EMAIL_LOCAL_PART.test(url) && /^@[a-z0-9]/i.test(nextText)
    const isDomainRemainderAfterAtSign = EMAIL_DOMAIN_PART.test(url) && EMAIL_PREFIX_BEFORE_DOMAIN.test(previousText)

    return isLocalPartBeforeAtSign || isDomainRemainderAfterAtSign
}

export const isLegacyEmailUrlFragment = (embedNode, url) => {
    if (!embedNode) return false

    return shouldRenderAsLegacyEmailText(
        url,
        embedNode.previousSibling?.textContent || '',
        embedNode.nextSibling?.textContent || ''
    )
}
