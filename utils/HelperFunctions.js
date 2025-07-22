import * as ImgManipulator from 'expo-image-manipulator'
import moment from 'moment'
import { Dimensions } from 'react-native-web'
import dom from 'react-dom'

import {
    POPOVER_DESKTOP_WIDTH,
    POPOVER_DESKTOP_WIDTH_V2,
    POPOVER_MOBILE_WIDTH,
    POPOVER_TABLET_WIDTH,
    POPOVER_TABLET_WIDTH_V2,
    SIDEBAR_MENU_WIDTH,
} from '../components/styles/global'
import store from '../redux/store'
import {
    hideFloatPopup,
    hideNoteAltShortcuts,
    hideNoteCtrlShortcuts,
    hideShortcuts,
    resetOpenModal,
    setShortcutFocusTasks,
    showNoteAltShortcuts,
    showNoteCtrlShortcuts,
    showShortcuts,
} from '../redux/actions'
import Backend from './BackendBridge'
import { getDateFormat } from '../components/UIComponents/FloatModals/DateFormatPickerModal'
import { BACKWARD_COMMENT, FORDWARD_COMMENT } from '../components/Feeds/Utils/HelperFunctions'
import { DONE_STEP, OPEN_STEP } from '../components/TaskListView/Utils/TasksHelper'
import { updateQuotaTraffic } from './backends/Premium/premiumFirestore'

class HelperFunctions {
    static isValidEmail = email => {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        return re.test(String(email).toLowerCase())
    }

    static getFirstName = fullName => {
        return fullName ? fullName.replace('#', '').trim().split(' ')[0] : ''
    }

    static getFNameFLastN = fullName => {
        return fullName.replace('#', '').trim().split(' ').slice(0, 2).join(' ')
    }

    static getDifference = (array1, array2) => {
        return array1.filter(x => !array2.includes(x))
    }

    static getIntersection = (array1, array2) => {
        return array1.filter(x => array2.includes(x))
    }

    static resizeImage = async (imageURI, size, base64 = true) => {
        return ImgManipulator.manipulateAsync(imageURI, [{ resize: { height: size } }], {
            compress: 1,
            format: ImgManipulator.SaveFormat.JPEG,
            base64: base64,
        })
    }

    static convertURItoBlob = async (uri, name = 'picture', contentType = 'image/png') => {
        return await fetch(uri)
            .then(r => r.blob())
            .then(blobFile => new File([blobFile], name, { type: contentType }))
    }

    static setRootStyles = () => {
        let css = '*:focus {outline: none}'
        let head = document.head || document.getElementsByTagName('head')[0]
        let style = document.createElement('style')

        head.appendChild(style)

        style.setAttribute('id', 'root-style')
        style.setAttribute('type', 'text/css')
        if (style.styleSheet) {
            // This is required for IE8 and below.
            style.styleSheet.cssText = css
        } else {
            style.appendChild(document.createTextNode(css))
        }
    }
}

export const MODAL_MAX_HEIGHT_GAP = 32
export const MENTION_MODAL_MIN_HEIGHT = 150

export const chronoKeysOrder = (a, b) => {
    if (a < b) {
        return -1
    } else {
        return 1
    }
}

export const chronoKeysOrderDesc = (a, b) => {
    if (a < b) {
        return 1
    } else {
        return -1
    }
}

export const chronoEntriesOrder = (a, b) => {
    if (a[0] < b[0]) {
        return -1
    } else {
        return 1
    }
}

export const chronoEntriesOrderDesc = (a, b) => {
    if (a[0] < b[0]) {
        return 1
    } else {
        return -1
    }
}

export const getWorkflowStepsIdsSorted = workflow => {
    const stepsIds = Object.keys(workflow).sort((a, b) => {
        return a < b ? -1 : 1
    })
    return stepsIds
}

export const getCommentDirectionWhenMoveTaskInTheWorklfow = (stepToMoveIndex, workflowStepsIds, stepHistory) => {
    if (stepToMoveIndex === OPEN_STEP) {
        return BACKWARD_COMMENT
    } else if (stepToMoveIndex === DONE_STEP) {
        return FORDWARD_COMMENT
    } else {
        const currentStepId = stepHistory[stepHistory.length - 1]
        const currentStepIndex = workflowStepsIds.indexOf(currentStepId)
        return stepToMoveIndex > currentStepIndex ? FORDWARD_COMMENT : BACKWARD_COMMENT
    }
}

export const getWorkflowStepId = (stepToMoveIndex, workflowStepsIds) => {
    return stepToMoveIndex === OPEN_STEP || stepToMoveIndex === DONE_STEP
        ? stepToMoveIndex
        : workflowStepsIds[stepToMoveIndex]
}

export const getDayName = (date, inUpperCase = true) => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const dayName = weekdays[moment(date).isoWeekday() - 1]
    return inUpperCase ? dayName.toUpperCase() : dayName
}

export const parseDate = (date, format, inUpperCase = true) => {
    const dateFormated = date.format(format)
    const currentDateFormated = moment().format(format)
    const tommorowDateFormated = moment().add(1, 'days').format(format)

    let toShowDate = dateFormated

    if (currentDateFormated === dateFormated) {
        toShowDate = inUpperCase ? 'TODAY' : 'Today'
    } else if (tommorowDateFormated === dateFormated) {
        toShowDate = inUpperCase ? 'TOMORROW' : 'Tomorrow'
    }

    return toShowDate
}

export const parsePastDate = (date, format) => {
    const dateFormated = date.format(format)
    const currentDateFormated = moment().format(format)
    const yesterdayDateFormated = moment().add(-1, 'days').format(format)
    let toShowDate = dateFormated

    if (currentDateFormated === dateFormated) {
        toShowDate = 'Today'
    } else if (yesterdayDateFormated === dateFormated) {
        toShowDate = 'Yesterday'
    }

    return toShowDate
}

export const popoverToCenter = (
    { targetRect, popoverRect, position, align, nudgedLeft, nudgedTop },
    isMobile = true
) => {
    const dim = Dimensions.get('window')
    const sidebarDiff = isMobile ? 0 : SIDEBAR_MENU_WIDTH / 2
    const top = dim.height / 2 - popoverRect.height / 2
    const left = dim.width / 2 - popoverRect.width / 2
    return { top: top, left: left + sidebarDiff }
}

export const popoverToSafePosition = (
    { targetRect, popoverRect, position, align, nudgedLeft, nudgedTop },
    isMobile = true
) => {
    const dim = Dimensions.get('window')
    const sidebarDiff = isMobile ? 0 : SIDEBAR_MENU_WIDTH / 2
    const padding = 16 // Safe padding from screen edges

    // For mobile devices, use smart positioning based on available space
    if (isMobile) {
        let top, left

        // Calculate available space
        const availableHeight = dim.height - 2 * padding
        const availableWidth = dim.width - 2 * padding

        // Emergency fallback for very small screens
        if (dim.height < 200) {
            return { top: 10, left: 10 }
        }

        // If the popover is taller than available space, position it at the top
        if (popoverRect.height >= availableHeight) {
            top = padding
        } else {
            // Try to center, but ensure it fits
            top = Math.max(
                padding,
                Math.min(dim.height / 2 - popoverRect.height / 2, dim.height - popoverRect.height - padding)
            )
        }

        // If the popover is wider than available space, position it at the left
        if (popoverRect.width >= availableWidth) {
            left = padding
        } else {
            // Try to center, but ensure it fits
            left = Math.max(
                padding,
                Math.min(dim.width / 2 - popoverRect.width / 2, dim.width - popoverRect.width - padding)
            )
        }

        return { top: top, left: left }
    }

    // For desktop/tablet, use the original center logic with sidebar adjustment
    let top = dim.height / 2 - popoverRect.height / 2
    let left = dim.width / 2 - popoverRect.width / 2 + sidebarDiff

    // Ensure the popover doesn't go off-screen
    // Check top boundary
    if (top < padding) {
        top = padding
    }

    // Check bottom boundary
    if (top + popoverRect.height > dim.height - padding) {
        top = dim.height - popoverRect.height - padding
    }

    // Check left boundary
    if (left < padding) {
        left = padding
    }

    // Check right boundary
    if (left + popoverRect.width > dim.width - padding) {
        left = dim.width - popoverRect.width - padding
    }

    return { top: top, left: left }
}

export const popoverToTop = ({ targetRect, popoverRect, position, align, nudgedLeft, nudgedTop }, isMobile = true) => {
    const dim = Dimensions.get('window')
    const sidebarDiff = isMobile ? 0 : SIDEBAR_MENU_WIDTH / 2
    const top = 80
    const left = dim.width / 2 - popoverRect.width / 2
    return { top: top, left: left + sidebarDiff }
}

export const shortcutPreviewMount = () => {
    document.addEventListener('keydown', showShortcutsPreview)
    document.addEventListener('keyup', hideShortcutsPreview)
    document.addEventListener('click', hideShortcutsPreview)
    document.addEventListener('visibilitychange', hideShortcutsPreview)
    window.addEventListener('focus', hideShortcutsPreview)
    window.addEventListener('blur', hideShortcutsPreview)
}

export const shortcutPreviewUnmount = () => {
    document.removeEventListener('keydown', showShortcutsPreview)
    document.removeEventListener('keyup', hideShortcutsPreview)
    document.removeEventListener('click', hideShortcutsPreview)
    document.removeEventListener('visibilitychange', hideShortcutsPreview)
    window.removeEventListener('focus', hideShortcutsPreview)
    window.removeEventListener('blur', hideShortcutsPreview)
}

export const showShortcutsPreview = event => {
    if (store.getState().blockShortcuts) {
        return
    }
    if (event.altKey && !store.getState().showShortcuts) {
        store.dispatch(showShortcuts())
        setShortcutFocusedTasks()
        event.preventDefault()
    }
}

export const hideShortcutsPreview = e => {
    if (store.getState().showShortcuts) {
        store.dispatch(hideShortcuts())
    }
}

const setShortcutFocusedTasks = () => {
    const { focusedTaskItem } = store.getState()
    const taskListEls = document.querySelectorAll('[aria-task-id]')

    if (taskListEls.length > 0) {
        if (focusedTaskItem.id === '') {
            store.dispatch(
                setShortcutFocusTasks({
                    current: taskListEls[0].getAttribute('aria-task-id'),
                    prev: '',
                    next: '',
                })
            )
        } else {
            const taskListIds = []
            taskListEls.forEach(el => taskListIds.push(el.getAttribute('aria-task-id')))

            let index = taskListIds.indexOf(focusedTaskItem.id)
            let indexPrev = index === 0 ? taskListIds.length - 1 : index - 1
            let indexNext = index === taskListIds.length - 1 ? 0 : index + 1
            store.dispatch(
                setShortcutFocusTasks({
                    current: focusedTaskItem.id,
                    prev: taskListIds[indexPrev],
                    next: taskListIds[indexNext],
                })
            )
        }
    }
}

export const shortcutNotePreviewMount = () => {
    document.addEventListener('keydown', showNoteShortcutsPreview)
    document.addEventListener('keyup', hideNoteShortcutsPreview)
    document.addEventListener('click', hideNoteShortcutsPreview)
    document.addEventListener('visibilitychange', hideNoteShortcutsPreview)
    window.addEventListener('focus', hideNoteShortcutsPreview)
    window.addEventListener('blur', hideNoteShortcutsPreview)
}

export const shortcutNotePreviewUnmount = () => {
    document.removeEventListener('keydown', showNoteShortcutsPreview)
    document.removeEventListener('keyup', hideNoteShortcutsPreview)
    document.removeEventListener('click', hideNoteShortcutsPreview)
    document.removeEventListener('visibilitychange', hideNoteShortcutsPreview)
    window.removeEventListener('focus', hideNoteShortcutsPreview)
    window.removeEventListener('blur', hideNoteShortcutsPreview)
}

export const showNoteShortcutsPreview = event => {
    if (store.getState().blockShortcuts) {
        return
    }
    if (event.altKey && !store.getState().showNoteAltShortcuts) {
        store.dispatch(showNoteAltShortcuts())
        event.preventDefault()
    }

    if ((event.ctrlKey || event.metaKey) && !store.getState().showNoteCtrlShortcuts) {
        store.dispatch(showNoteCtrlShortcuts())
        event.preventDefault()
    }
}

export const hideNoteShortcutsPreview = e => {
    if (store.getState().showNoteAltShortcuts) {
        store.dispatch(hideNoteAltShortcuts())
    }
    if (store.getState().showNoteCtrlShortcuts) {
        store.dispatch(hideNoteCtrlShortcuts())
    }
}

export const execShortcutFn = (ref, shortcutFunction, event) => {
    dom.findDOMNode(ref)?.click()
    shortcutFunction()
    event?.preventDefault()
}

export const isInputsFocused = () => {
    const activeElement = document.activeElement
    const inputs = ['input', 'textarea']
    const isQuillFocused = activeElement.classList.contains('ql-editor')
    return (activeElement && inputs.indexOf(activeElement.tagName.toLowerCase()) !== -1) || isQuillFocused
}

export const calculateTimeDuration = secs => {
    let hr = Math.floor(secs / 3600)
    let min = Math.floor((secs - hr * 3600) / 60)
    let sec = Math.floor(secs - hr * 3600 - min * 60)
    if (min < 10) min = '0' + min
    if (sec < 10) sec = '0' + sec
    if (hr <= 0) return min + ':' + sec
    return hr + ':' + min + ':' + sec
}

export const getPopoverWidth = () => {
    const { isMiddleScreen: tablet, smallScreenNavigation: mobile } = store.getState()
    return mobile ? POPOVER_MOBILE_WIDTH : tablet ? POPOVER_TABLET_WIDTH : POPOVER_DESKTOP_WIDTH
}

export const applyPopoverWidth = (setMin = true, setMax = true) => {
    const width = getPopoverWidth()
    const min = { minWidth: width }
    const max = { maxWidth: width }
    return { ...(setMin ? min : {}), ...(setMax ? max : {}) }
}

const getPopoverWidthv2 = (isMiddleScreen, smallScreenNavigation, windowWidth) => {
    return smallScreenNavigation
        ? windowWidth - 50
        : isMiddleScreen
        ? POPOVER_TABLET_WIDTH_V2
        : POPOVER_DESKTOP_WIDTH_V2
}

export const applyPopoverWidthV2 = (isMiddleScreen, smallScreenNavigation, windowWidth) => {
    const width = getPopoverWidthv2(isMiddleScreen, smallScreenNavigation, windowWidth)
    return { minWidth: width > POPOVER_MOBILE_WIDTH ? width : POPOVER_MOBILE_WIDTH, maxWidth: width }
}

export const forceCloseModals = tryToRemove => {
    document.querySelectorAll('.react-tiny-popover-container').forEach(e => {
        if (e?.parentNode) e?.parentNode?.click?.()
        else if (tryToRemove) e?.remove?.()
    })
}

export const dismissAllPopups = (tryToHide = false, tryToRemove = false, resetModals = false) => {
    if (tryToHide) store.dispatch(hideFloatPopup())
    forceCloseModals(tryToRemove)
    if (resetModals) store.dispatch(resetOpenModal())
}

export const dismissPopupInBackground = (modalId, condition = true, time = 2500) => {
    const modal = document.getElementById(modalId)
    if (modal && condition) {
        setTimeout(() => {
            if (modal && condition) {
                modal.remove()
            }
        }, time)
    }
}

const fallbackCopyTextToClipboard = text => {
    let textArea = document.createElement('textarea')
    textArea.value = text

    // Avoid scrolling to bottom
    textArea.style.top = '0'
    textArea.style.left = '0'
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'

    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    try {
        let successful = document.execCommand('copy')
        let msg = successful ? 'successful' : 'unsuccessful'
        // console.log('Fallback: Copying text command was ' + msg)
    } catch (err) {
        // console.error('Fallback: Oops, unable to copy', err)
    }

    document.body.removeChild(textArea)
}
export const copyTextToClipboard = text => {
    if (!navigator.clipboard) {
        fallbackCopyTextToClipboard(text)
        return
    }
    navigator.clipboard.writeText(text).then(
        function () {
            // console.log('Async: Copying to clipboard was successful!')
        },
        function (err) {
            // console.error('Async: Could not copy text: ', err)
        }
    )
}

export function getFileSize(projectId, url, uid) {
    let fileSize = ''
    let http = new XMLHttpRequest()
    http.open('GET', url, true) // true = Asynchronous
    http.onreadystatechange = function () {
        if (this.readyState == this.DONE) {
            if (this.status === 200) {
                fileSize = this.getResponseHeader('content-length')
                updateQuotaTraffic(projectId, uid, Number(fileSize) / 1024 / 1024)
            }
        }
    }
    http.send()
}

export const parseLastEdit = async (lastEditDate, setEditionText) => {
    const tablet = store.getState().isMiddleScreen
    const serverDate = await Backend.getFirebaseTimestampDirectly()

    if (serverDate) {
        let text = ''
        const today = moment(serverDate)
        const lastEdit = moment(lastEditDate)

        const secondsDiff = today.diff(lastEdit, 'seconds')
        if (secondsDiff < 60) {
            if (secondsDiff === 1) {
                text = tablet ? '1 sec ago' : '1 second ago'
            }
            text = `${secondsDiff} ${tablet ? 'sec ago' : 'seconds ago'}`
        } else {
            const minutesDiff = today.diff(lastEdit, 'minutes')
            if (minutesDiff < 60) {
                if (minutesDiff === 1) {
                    text = tablet ? '1 min ago' : '1 minute ago'
                }
                text = `${minutesDiff} ${tablet ? 'min ago' : 'minutes ago'}`
            } else {
                const hoursDiff = today.diff(lastEdit, 'hours')
                if (hoursDiff < 24) {
                    if (hoursDiff === 1) {
                        text = '1 hour ago'
                    }
                    text = `${hoursDiff} hours ago`
                } else {
                    text = moment(lastEditDate).format(getDateFormat())
                }
            }
        }

        setEditionText(text)
    }
}

export const getCustomStyle = (inTaskDV, user, inFeedComment) => {
    return inTaskDV
        ? [{ height: 32, paddingRight: 12, paddingLeft: 7 }, user && { paddingLeft: 4 }]
        : inFeedComment
        ? { minHeight: 20, height: 20, paddingRight: 6 }
        : { height: 24, paddingRight: 8 }
}

export default HelperFunctions
