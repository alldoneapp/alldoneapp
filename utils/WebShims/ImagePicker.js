// Web replacement for expo-image-picker (migration Stage 1).
// Covers the surface the app uses: MediaTypeOptions, launchImageLibraryAsync,
// requestCameraRollPermissionsAsync (native-only call sites; stubbed granted).
// Mirrors expo's own web implementation: a hidden <input type="file"> whose
// selection is read into a data URL. `allowsEditing`/`aspect` are native-only
// and ignored on web, exactly as expo did. The legacy `cancelled` spelling is
// kept because both call sites read it.

export const MediaTypeOptions = {
    All: 'All',
    Images: 'Images',
    Videos: 'Videos',
}

const ACCEPT_BY_MEDIA_TYPE = {
    [MediaTypeOptions.All]: 'image/*,video/*',
    [MediaTypeOptions.Images]: 'image/*',
    [MediaTypeOptions.Videos]: 'video/*',
}

export const requestCameraRollPermissionsAsync = () => Promise.resolve({ status: 'granted', granted: true })

const readFileAsDataUrl = file =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })

const getImageSize = uri =>
    new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => resolve({ width: 0, height: 0 })
        img.src = uri
    })

export const launchImageLibraryAsync = ({ mediaTypes = MediaTypeOptions.Images } = {}) =>
    new Promise(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = ACCEPT_BY_MEDIA_TYPE[mediaTypes] || ACCEPT_BY_MEDIA_TYPE[MediaTypeOptions.Images]
        input.style.display = 'none'
        document.body.appendChild(input)

        let settled = false
        const settle = result => {
            if (settled) return
            settled = true
            window.removeEventListener('focus', onFocusBack)
            input.remove()
            resolve(result)
        }

        // The file dialog gives no cancel event; when focus returns without a
        // change event having fired shortly after, treat it as a cancel.
        const onFocusBack = () => {
            setTimeout(() => settle({ cancelled: true }), 400)
        }

        input.onchange = async () => {
            const file = input.files && input.files[0]
            if (!file) return settle({ cancelled: true })
            try {
                const uri = await readFileAsDataUrl(file)
                const isImage = /^image\//.test(file.type)
                const { width, height } = isImage ? await getImageSize(uri) : { width: 0, height: 0 }
                settle({ cancelled: false, uri, width, height, type: isImage ? 'image' : 'video' })
            } catch (e) {
                settle({ cancelled: true })
            }
        }

        window.addEventListener('focus', onFocusBack)
        input.click()
    })
