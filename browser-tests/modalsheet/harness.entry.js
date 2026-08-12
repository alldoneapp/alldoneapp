/**
 * ModalShell / BottomSheet browser harness — entry point (Phase 2 of
 * MODAL_IMPROVEMENT_PLAN.md).
 *
 * Why a browser test: the shell's guarantees are composition properties of
 * layers jsdom cannot faithfully host together — real touch-vs-click event
 * timing (the AT-2236 mount grace), react-native-web's TextInput swallowing
 * keydown while the capture-phase escape stack still sees it (AT-2257), two
 * portalled sheets stacking with LIFO Escape, and the document scroll lock
 * against the real body scroller.
 *
 * Everything here is the REAL module: AppPopover → BottomSheet →
 * useModalSizing, the real escapeStack, the real popupDismissGuard, the real
 * vendored react-tiny-popover on the desktop path.
 */
import 'setimmediate'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'

import { installEscapeStack } from '../../utils/escapeStack'
import AppPopover from '../../components/UIComponents/ModalShell/AppPopover'

// `AppNavigator`'s `AppContainer` does exactly this in the real app.
installEscapeStack()

let setOuterOpenExternal = () => {}
let setNestedOpenExternal = () => {}
let nestedActionCount = 0

function Harness() {
    const [outerOpen, setOuterOpen] = useState(false)
    const [nestedOpen, setNestedOpen] = useState(false)
    setOuterOpenExternal = setOuterOpen
    setNestedOpenExternal = setNestedOpen

    const nestedContent = (
        <View style={{ padding: 16, backgroundColor: '#0D2050' }}>
            <Text testID={'nested-content'} style={{ color: '#ffffff' }}>
                NESTED PICKER
            </Text>
            <TouchableOpacity testID={'nested-action'} onPress={() => nestedActionCount++}>
                <Text style={{ color: '#ffffff', padding: 12 }}>NESTED ACTION</Text>
            </TouchableOpacity>
        </View>
    )

    const outerContent = (
        <View style={{ padding: 16, width: 280 }}>
            <Text testID={'outer-content'} style={{ color: '#ffffff' }}>
                OUTER SHEET
            </Text>
            <TextInput
                testID={'sheet-input'}
                placeholder={'type here'}
                style={{ color: '#ffffff', borderWidth: 1, borderColor: '#ffffff', padding: 8, marginVertical: 12 }}
            />
            <AppPopover
                isOpen={nestedOpen}
                onClickOutside={() => setNestedOpen(false)}
                content={nestedContent}
                position={['bottom']}
                align={'center'}
            >
                <TouchableOpacity testID={'open-nested'} onPress={() => setNestedOpen(true)}>
                    <Text style={{ color: '#ffffff', padding: 12 }}>OPEN NESTED</Text>
                </TouchableOpacity>
            </AppPopover>
        </View>
    )

    return (
        <View style={{ flex: 1, padding: 24 }}>
            <AppPopover
                isOpen={outerOpen}
                onClickOutside={() => setOuterOpen(false)}
                content={outerContent}
                position={['bottom']}
                align={'start'}
            >
                <TouchableOpacity testID={'open-outer'} onPress={() => setOuterOpen(true)}>
                    <Text style={{ padding: 12 }}>OPEN SHEET</Text>
                </TouchableOpacity>
            </AppPopover>
        </View>
    )
}

const rect = element => {
    if (!element) return null
    const { width, left, right, bottom } = element.getBoundingClientRect()
    return { width, left, right, bottom }
}

window.__state = () => ({
    outerOpen: !!document.querySelector('[data-testid="outer-content"]'),
    nestedOpen: !!document.querySelector('[data-testid="nested-content"]'),
    sheets: document.querySelectorAll('[data-testid="bottom-sheet"]').length,
    popoverContainers: document.querySelectorAll('.react-tiny-popover-container').length,
    bodyOverflowY: document.body.style.overflowY,
    sheetRect: rect(document.querySelector('[data-testid="bottom-sheet"]')),
    nestedActionCount,
    focusedTag: document.activeElement ? document.activeElement.tagName : null,
})

window.__openOuter = () => setOuterOpenExternal(true)
window.__openNested = () => setNestedOpenExternal(true)

createRoot(document.getElementById('root')).render(<Harness />)

window.__ready = true
