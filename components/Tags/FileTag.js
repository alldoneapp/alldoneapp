import React from 'react'
import { Text, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'

const extensionsMap = {
    jpg: 'image',
    bmp: 'image',
    png: 'image',
    ico: 'image',
    tiff: 'image',
    psd: 'image',
    pdf: 'file',
    doc: 'file',
    txt: 'file',
    docx: 'file',
    avi: 'video',
    mpg: 'video',
    mpeg: 'video',
    mp4: 'video',
    mkv: 'video',
    wmv: 'video',
    webm: 'video',
}

const maxWidth1 = 211
const maxWidth2 = 244

const FileTag = ({ file, canBeRemoved, textStyle, onCloseFile }) => {
    const filename = file.file ? file.file.name : file.name

    return (
        <View style={{ flexDirection: 'row' }}>
            <View style={[localStyles.container]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name={getIconFromExtension(filename)} size={16} color={colors.Text03}></Icon>
                    <Text
                        style={[
                            styles.subtitle2,
                            {
                                color: colors.Text03,
                                height: 22,
                                maxWidth: canBeRemoved ? maxWidth1 : maxWidth2,
                                marginLeft: 7,
                                paddingRight: 4,
                            },
                            textStyle,
                            windowTagStyle(),
                        ]}
                        ellipsizeMode={'middle'}
                        numberOfLines={1}
                    >
                        {filename}
                    </Text>
                    {canBeRemoved && (
                        <TouchableOpacity onPress={() => onCloseFile(file.index)} style={{ marginLeft: 4 }}>
                            <Icon name={'x-circle'} size={16} color={colors.Text03}></Icon>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </View>
    )
}

function getIconFromExtension(filename) {
    const parts = filename.split('.')
    if (parts.length > 0) {
        const type = extensionsMap[parts[parts.length - 1].toLowerCase()]
        return type ? type : 'file'
    }
    return 'file'
}

export default FileTag

const localStyles = {
    container: {
        flex: -1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        paddingRight: 4,
        paddingLeft: 4,
        height: 24,
    },
}
