import React, { useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import Shortcut from '../Shortcut'
import Options from './Options'
import ShortcutToggle from './ShortcutToggle'
import AactiveIndicator from './AactiveIndicator'

export default function MultiToggleSwitch({ currentIndex, options, onChangeOption, containerStyle }) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)

    const optionsRefs = useRef(options.map(_ => null))

    const onSelectOption = (index, optionText) => {
        if (onChangeOption) onChangeOption(index, optionText)
    }

    useEffect(() => {
        optionsRefs.current = options.map(_ => null)
    }, [JSON.stringify(options)])

    return (
        <View style={containerStyle}>
            <View style={localStyles.backContainer}>
                <ShortcutToggle currentIndex={currentIndex} options={options} onSelectOption={onSelectOption} />
                <AactiveIndicator optionsRefs={optionsRefs.current} currentIndex={currentIndex} options={options} />
                <Options
                    optionsRefs={optionsRefs.current}
                    onSelectOption={onSelectOption}
                    currentIndex={currentIndex}
                    options={options}
                />
            </View>
            {showShortcuts && showFloatPopup === 0 && (
                <Shortcut text={'G'} containerStyle={[{ position: 'absolute', top: -4, right: 0 }]} />
            )}
        </View>
    )
}

MultiToggleSwitch.defaultProps = {
    currentIndex: 0,
}

const localStyles = StyleSheet.create({
    backContainer: {
        height: 26,
        position: 'relative',
        alignSelf: 'baseline',
        paddingTop: 2,
        paddingBottom: 2,
        paddingLeft: 2,
        paddingRight: 2,
        flexDirection: 'row',
        backgroundColor: colors.Grey300,
        borderRadius: 14,
        overflow: 'hidden',
    },
})
