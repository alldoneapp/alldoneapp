import React from 'react'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

export default function ShortcutToggle({ currentIndex, options, onSelectOption }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const onShortcutToggle = () => {
        const indexes = []
        for (let i = 0; i < options.length; i++) {
            if (options[i]) indexes.push({ index: i, option: options[i] })
        }

        const index = currentIndex === options.length - 1 ? indexes[0] : indexes[currentIndex + 1]
        onSelectOption(index.index, index.option.text)
    }
    return <Hotkeys disabled={blockShortcuts} keyName={'alt+G'} onKeyDown={onShortcutToggle} filter={e => true} />
}
