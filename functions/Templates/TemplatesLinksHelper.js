const { defineString } = require('firebase-functions/params')

const objectTypesToCopy = ['tasks', 'goals', 'notes', 'contacts', 'assistants']

const removeEndSlashs = url => {
    return url.replace(/\/+$/, '')
}

const addProtocol = url => {
    const hasProtocol = url.startsWith('http') || url.startsWith('ftp') || url.startsWith('file')
    return hasProtocol ? url : `http://${url}`
}

const getUrlParts = url => {
    const urlParts = url.split('/')
    return { protocol: urlParts[0], host: urlParts[2] }
}

const getAppUrlHost = () => {
    const hostingUrl = defineString('HOSTING_URL').value()
    const { host } = getUrlParts(hostingUrl)
    return host
}

const isValidProtocol = protocol => {
    return protocol === 'https:' || protocol === 'http:'
}

const isValidHost = host => {
    return host === getAppUrlHost() || host === 'localhost:19006'
}

const checkIfIsInternalUrl = urlParts => {
    const protocol = urlParts[0]
    const host = urlParts[2]

    return isValidProtocol(protocol) && isValidHost(host)
}

const checkIfBelongsToProject = (templateId, urlParts) => {
    const innerPath = urlParts[3]
    const urlProjectId = urlParts[4]

    const isProjectUrl = innerPath === 'project' || innerPath === 'projects'
    const sameProjectId = urlProjectId === templateId

    return isProjectUrl && sameProjectId
}

const checkIfIsMainList = (urlParts, userId) => {
    const innerPath = urlParts[5]
    const userIdPath = urlParts[6]
    const objectPath = urlParts[7]
    const isMainList = innerPath === 'user' && userIdPath === userId && objectTypesToCopy.includes(objectPath)
    return isMainList
}

const checkIfIsDv = (urlParts, objectsMap) => {
    const objectPath = urlParts[5]
    const objectId = urlParts[6]
    const isAnObjectTypeToCopy = objectTypesToCopy.includes(objectPath)
    const isAnObjectToCopy = objectsMap[objectPath] && objectsMap[objectPath][objectId]
    return isAnObjectTypeToCopy && isAnObjectToCopy
}

const checkIfIsProjectDv = urlParts => {
    const innerPath = urlParts[3]
    const isProjectDvUrl = innerPath === 'project'
    return isProjectDvUrl
}

const generateUpdatedUrl = (urlParts, isMainList, isDv, guideId, userId, objectsMap) => {
    let newUrl = urlParts[0] + '/' + urlParts[1] + '/' + urlParts[2] + '/' + urlParts[3] + '/' + guideId + '/'
    if (isMainList) {
        newUrl += urlParts[5] + '/' + userId + '/' + urlParts[7] + '/' + urlParts[8]
    } else if (isDv) {
        newUrl += urlParts[5] + '/' + objectsMap[urlParts[5]][urlParts[6]].id + '/' + urlParts[7]
        if (urlParts[8]) newUrl += '/' + urlParts[8]
    } else {
        newUrl += urlParts[5]
        if (urlParts[6]) newUrl += '/' + urlParts[6]
    }
    return newUrl
}

const replaceIdsInUrl = (templateId, creatorId, objectsMap, initialUrl, guideId, userId) => {
    let tmpUrl = initialUrl
    tmpUrl = removeEndSlashs(tmpUrl)
    tmpUrl = addProtocol(tmpUrl)

    const urlParts = tmpUrl.split('/')

    const isInternal = checkIfIsInternalUrl(urlParts)
    const belongsToTemplate = checkIfBelongsToProject(templateId, urlParts)

    const isMainList = checkIfIsMainList(urlParts, creatorId)
    const isDv = checkIfIsDv(urlParts, objectsMap)
    const isProjectDv = checkIfIsProjectDv(urlParts)

    const belongsToTypeOfObjectToCopy = isMainList || isDv || isProjectDv

    if (isInternal && belongsToTemplate && belongsToTypeOfObjectToCopy) {
        const newUrl = generateUpdatedUrl(urlParts, isMainList, isDv, guideId, userId, objectsMap)
        return newUrl
    }

    return initialUrl
}

module.exports = { replaceIdsInUrl }
