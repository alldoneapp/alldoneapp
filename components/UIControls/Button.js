import React, { Component } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, ViewPropTypes } from 'react-native'
import * as PropTypes from 'prop-types'
import Icon from '../Icon'
import Spinner from '../UIComponents/Spinner'
import store from '../../redux/store'
import Shortcut from './Shortcut'
import GoalProgress from '../Feeds/CommentsTextInput/MentionsModal/GoalProgress'

class Button extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            finalStyles: this.getMasterStyle(),
            showShortcuts: storeState.showShortcuts,
            showFloatPopup: storeState.showFloatPopup,
            unsubscribe: store.subscribe(this.updateState),
        }
        this._isMounted = false
    }

    componentDidMount() {
        this._isMounted = true
        const {
            type,
            title,
            disabled,
            icon,
            color,
            textColor,
            iconColor,
            noBorder,
            buttonStyle,
            titleStyle,
            customIcon,
        } = this.props
        this.buildFinalStyle(
            type,
            title,
            icon,
            color,
            disabled,
            textColor,
            iconColor,
            noBorder,
            buttonStyle,
            titleStyle,
            customIcon
        )
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (
            this.props.type !== prevProps.type ||
            this.props.title !== prevProps.title ||
            this.props.disabled !== prevProps.disabled ||
            this.props.icon !== prevProps.icon ||
            this.props.color !== prevProps.color ||
            this.props.textColor !== prevProps.textColor ||
            this.props.iconColor !== prevProps.iconColor ||
            this.props.noBorder !== prevProps.noBorder ||
            this.props.buttonStyle !== prevProps.buttonStyle ||
            this.props.titleStyle !== prevProps.titleStyle
        ) {
            this.buildFinalStyle(
                this.props.type,
                this.props.title,
                this.props.icon,
                this.props.color,
                this.props.disabled,
                this.props.textColor,
                this.props.iconColor,
                this.props.noBorder,
                this.props.buttonStyle,
                this.props.titleStyle,
                this.props.customIcon
            )
        }
    }

    componentWillUnmount() {
        this._isMounted = false
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()
        if (!this._isMounted) {
            return
        }
        this.setState({
            showShortcuts: storeState.showShortcuts,
            showFloatPopup: storeState.showFloatPopup,
        })
    }

    getMasterStyle = () => {
        return {
            btnStyle: [styles.buttonMaster],
            textStyle: [styles.textMaster],
            iconStyle: iconStyle.textMaster,
        }
    }

    /**
     * Return an object with the button style and the text style
     *
     * @param type          ['primary', 'secondary', 'text', 'ghost']
     * @param title         String
     * @param icon          String | Element
     * @param color         String
     * @param disabled      Boolean
     * @param textColor     ['blue', 'red']
     * @param iconColor     String
     * @param noBorder      Boolean
     * @param buttonStyle   object
     * @param titleStyle    object
     */
    buildFinalStyle = (
        type,
        title,
        icon,
        color,
        disabled,
        textColor,
        iconColor,
        noBorder,
        buttonStyle,
        titleStyle,
        customIcon
    ) => {
        let finalStyles = this.getMasterStyle()

        // Section to apply theme by type
        switch (type) {
            case 'danger':
                finalStyles.btnStyle.push(styles.buttonDanger)
                finalStyles.textStyle.push(styles.textDanger)
                finalStyles.iconStyle = iconStyle.textDanger
                break
            case 'secondary':
                finalStyles.btnStyle.push(styles.buttonSecondary)
                finalStyles.textStyle.push(styles.textSecondary)
                finalStyles.iconStyle = iconStyle.textSecondary
                break
            case 'text':
                finalStyles.btnStyle.push(styles.buttonText)
                // if no pass textColor then assume blue
                if (!textColor) {
                    finalStyles.textStyle.push(styles.textTextDefault)
                    finalStyles.iconStyle = iconStyle.textTextDefault
                }

                break
            case 'ghost':
                finalStyles.btnStyle.push(styles.buttonGhost)
                finalStyles.textStyle.push(styles.textGhostDefault)
                finalStyles.iconStyle = iconStyle.textGhostDefault
                break
            default:
                // if no TYPE is passed just use 'primary'
                finalStyles.btnStyle.push(styles.buttonPrimary)
                finalStyles.textStyle.push(styles.textPrimary)
                finalStyles.iconStyle = iconStyle.textPrimary
                break
        }

        // Apply text & icon color
        if (textColor) {
            if (textColor === 'red') {
                finalStyles.textStyle.push(styles.textTextError)
                finalStyles.iconStyle = iconStyle.textTextError
            } else if (textColor === 'red') {
                finalStyles.textStyle.push(styles.textTextDefault)
                finalStyles.iconStyle = iconStyle.textTextDefault
            } else {
                finalStyles.textStyle.push({ color: textColor })
                finalStyles.iconStyle = textColor
            }
        }

        if ((icon == null || icon === '') && (color == null || color === '') && !customIcon) {
            finalStyles.btnStyle.push(styles.buttonMasterOnlyText)
        }

        // Section to apply styles by props
        if (disabled) {
            finalStyles.btnStyle.push(styles.buttonMasterDisabled)
        }

        if (noBorder) {
            finalStyles.btnStyle.push(styles.buttonMasterNoBorder)
        }

        if (title == null || title === '') {
            finalStyles.btnStyle.push(styles.buttonMasterOnlyIcon)
        }

        // Section to apply custom styles
        finalStyles.btnStyle.push(buttonStyle)
        finalStyles.textStyle.push(titleStyle)

        // Section to apply custom color to icon
        if (iconColor != null && iconColor !== '') {
            finalStyles.iconStyle = iconColor
        } else if (titleStyle.hasOwnProperty('color')) {
            finalStyles.iconStyle = titleStyle.color
        }

        this.setState({ finalStyles: finalStyles })
    }

    render() {
        const { finalStyles, showShortcuts, showFloatPopup } = this.state
        const {
            title,
            onPress,
            icon,
            disabled,
            color,
            innerRef,
            processing,
            processingTitle,
            shortcutText,
            shortcutStyle,
            shortcutTextStyle,
            forceShowShortcut,
            forceShowShortcutForReal,
            numberTitleLines,
            onlyLayout,
            customIcon,
            iconSize,
            accessible,
            projectId,
            ...props
        } = this.props

        const { btnStyle, textStyle, iconStyle } = finalStyles

        let content = {}
        if (processing) {
            content = (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Spinner containerSize={24} spinnerSize={18} />
                    <Text style={[textStyle, { marginLeft: 12 }]} numberOfLines={numberTitleLines}>
                        {processingTitle || ''}
                    </Text>
                </View>
            )
        } else {
            content = title != null && title !== '' && (
                <Text
                    style={[
                        textStyle,
                        {
                            marginLeft:
                                (icon == null || icon === '') && (color == null || color === '') && !customIcon
                                    ? 0
                                    : 12,
                        },
                    ]}
                    numberOfLines={numberTitleLines}
                >
                    {title}
                </Text>
            )
        }

        return (
            <TouchableOpacity
                {...props}
                ref={innerRef}
                onPress={onPress}
                disabled={disabled || onlyLayout}
                style={btnStyle}
                accessible={accessible}
            >
                {icon == null || icon === '' ? undefined : typeof icon === 'string' ? (
                    <Icon name={icon} size={iconSize ? iconSize : 24} color={iconStyle} />
                ) : (
                    icon
                )}
                {color && <View style={[styles.projectMarker, { backgroundColor: color }]} />}

                {customIcon}

                {content}

                {((forceShowShortcutForReal && shortcutText) ||
                    (showShortcuts && shortcutText && (showFloatPopup === 0 || forceShowShortcut))) && (
                    <View
                        style={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'rgba(138, 148, 166, 0.24)',
                            borderRadius: 4,
                            top: 0,
                            right: 0,
                            left: 0,
                            bottom: 0,
                        }}
                    >
                        <Shortcut
                            text={shortcutText}
                            containerStyle={[{ position: 'absolute', top: -2, right: -2 }, shortcutStyle]}
                            textStyle={shortcutTextStyle}
                        />
                    </View>
                )}
            </TouchableOpacity>
        )
    }
}

Button.propTypes = {
    type: PropTypes.oneOf(['primary', 'danger', 'secondary', 'text', 'ghost']).isRequired,
    title: PropTypes.string,
    disabled: PropTypes.bool,
    icon: PropTypes.oneOfType([PropTypes.string, PropTypes.element]),
    textColor: PropTypes.oneOf(['blue', 'red']),
    iconColor: PropTypes.string,
    noBorder: PropTypes.bool,
    onPress: PropTypes.func,
    buttonStyle: ViewPropTypes.style,
    titleStyle: Text.propTypes.style,
    shortcutText: PropTypes.string,
    shortcutTextStyle: Text.propTypes.style,
    forceShowShortcut: PropTypes.bool,
    shortcutStyle: ViewPropTypes.style,
    numberTitleLines: PropTypes.number,
    onlyLayout: PropTypes.bool,
    accessible: PropTypes.bool,
}

Button.defaultProps = {
    type: 'primary',
    title: null,
    disabled: false,
    icon: null,
    iconColor: null,
    noBorder: false,
    onPress: undefined,
    buttonStyle: {},
    titleStyle: {},
    forceShowShortcut: false,
    numberTitleLines: 1,
    onlyLayout: false,
    accessible: false,
}

const styles = StyleSheet.create({
    // Master button styles
    buttonMaster: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 16,
        height: 40,
        maxHeight: 40,
        minHeight: 40,
        borderRadius: 4,
        backgroundColor: '#04142F',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
    },
    projectMarker: {
        width: 16,
        height: 16,
        borderRadius: 100,
    },
    buttonMasterOnlyIcon: {
        paddingLeft: 8,
        paddingRight: 8,
    },
    buttonMasterOnlyText: {
        paddingLeft: 16,
        paddingRight: 16,
    },
    buttonMasterNoBorder: {
        borderWidth: 0,
    },
    textMaster: {
        flexWrap: 'nowrap',
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 16,
        letterSpacing: 0.8,
        color: '#FFFFFF',
        alignSelf: 'center',
        paddingVertical: 0,
        paddingHorizontal: 0,
        margin: 0,
    },
    buttonMasterDisabled: {
        opacity: 0.5,
    },
    buttonMasterFocus: {
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: '#5AACFF',
    },

    // Primary Button Styles
    buttonPrimary: {
        backgroundColor: '#0D55CF',
    },
    buttonPrimaryHover: {
        backgroundColor: '#0A44A5',
    },
    buttonPrimaryFocus: {
        backgroundColor: '#0D55CF',
    },
    buttonPrimaryPressed: {
        backgroundColor: '#0A44A5',
    },
    textPrimary: {
        color: '#ffffff',
    },

    // Danger Button Styles
    buttonDanger: {
        backgroundColor: '#E00000',
    },
    buttonDangerHover: {
        backgroundColor: '#A00000',
    },
    buttonDangerFocus: {
        backgroundColor: '#E00000',
    },
    buttonDangerPressed: {
        backgroundColor: '#A00000',
    },
    textDanger: {
        color: '#ffffff',
    },

    // Secondary Button Styles
    buttonSecondary: {
        backgroundColor: '#EAF0F5',
    },
    buttonSecondaryHover: {
        backgroundColor: '#E3EBF2',
    },
    buttonSecondaryFocus: {
        backgroundColor: '#F1F5F8',
    },
    buttonSecondaryPressed: {
        backgroundColor: '#E3EBF2',
    },
    textSecondary: {
        color: '#04142F',
    },

    // Text Button Styles
    buttonText: {
        backgroundColor: 'transparent',
    },
    buttonTextHover: {
        backgroundColor: 'transparent',
    },
    buttonTextFocus: {
        backgroundColor: 'transparent',
    },
    buttonTextPressed: {
        backgroundColor: '#F1F5F8',
    },
    textTextDefault: {
        color: '#0D55CF',
    },
    textTextHover: {
        color: '#0A44A5',
    },
    textTextFocus: {
        color: '#0D55CF',
    },
    textTextPressed: {
        color: '#0A44A5',
    },
    textTextError: {
        color: '#E00000',
    },
    textTextErrorBorder: {
        borderColor: '#E00000',
    },

    // Ghost Button Styles
    buttonGhost: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: '#C6CDD2',
    },
    buttonGhostHover: {
        backgroundColor: 'transparent',
        borderColor: '#C6CDD2',
    },
    buttonGhostFocus: {
        backgroundColor: 'transparent',
    },
    buttonGhostPressed: {
        backgroundColor: '#F1F5F8',
        borderColor: 'transparent',
    },
    textGhostDefault: {
        color: '#8A94A6',
    },
    textGhostHover: {
        color: '#4E5D78',
    },
    textGhostFocus: {
        color: '#4E5D78',
    },
    textGhostPressed: {
        color: '#04142F',
    },
})

// Define icon colors
const iconStyle = {
    textMaster: '#ffffff',
    textPrimary: '#ffffff',
    textDanger: '#ffffff',
    textSecondary: '#04142F',
    textTextDefault: '#0D55CF',
    textTextHover: '#0A44A5',
    textTextFocus: '#0D55CF',
    textTextPressed: '#0A44A5',
    textTextError: '#E00000',
    textGhostDefault: '#8A94A6',
    textGhostHover: '#4E5D78',
    textGhostFocus: '#4E5D78',
    textGhostPressed: '#04142F',
}

export default React.forwardRef((props, ref) => <Button innerRef={ref} {...props} />)
