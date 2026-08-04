// Web replacement for expo-image-manipulator (migration Stage 1).
// Covers the surface the app uses: SaveFormat + manipulateAsync with a resize
// action, implemented with a canvas — which is exactly how expo's own web
// implementation worked. Resizing with only width or only height preserves the
// aspect ratio, matching expo's semantics (HelperFunctions.resizeImage passes
// only a height).

export const SaveFormat = {
    JPEG: 'jpeg',
    PNG: 'png',
    WEBP: 'webp',
}

const MIME_BY_FORMAT = {
    [SaveFormat.JPEG]: 'image/jpeg',
    [SaveFormat.PNG]: 'image/png',
    [SaveFormat.WEBP]: 'image/webp',
}

const loadImage = uri =>
    new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Could not load image for manipulation'))
        img.src = uri
    })

export const manipulateAsync = async (uri, actions = [], saveOptions = {}) => {
    const { compress = 1, format = SaveFormat.JPEG, base64 = false } = saveOptions
    const img = await loadImage(uri)

    let width = img.naturalWidth
    let height = img.naturalHeight

    for (const action of actions) {
        if (action.resize) {
            const { width: targetWidth, height: targetHeight } = action.resize
            if (targetWidth && targetHeight) {
                width = targetWidth
                height = targetHeight
            } else if (targetWidth) {
                height = Math.round((height / width) * targetWidth) || 1
                width = targetWidth
            } else if (targetHeight) {
                width = Math.round((width / height) * targetHeight) || 1
                height = targetHeight
            }
        }
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)

    const mime = MIME_BY_FORMAT[format] || MIME_BY_FORMAT[SaveFormat.JPEG]
    const dataUrl = canvas.toDataURL(mime, compress)

    const result = { uri: dataUrl, width, height }
    if (base64) {
        result.base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    }
    return result
}
