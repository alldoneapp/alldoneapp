import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'
import FileTag from '../Tags/FileTag'

const ShowAttachmentsModal = ({ attachments, hidePopover }) => {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.innerContainer}>
                <View style={localStyles.heading}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: 'white' }]}>Attachments</Text>
                        <Text style={[styles.body2, { color: colors.Text03, width: 262 }]}>
                            Files attached to this update
                        </Text>
                    </View>

                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeSubContainer} onPress={hidePopover}>
                            <Icon name="x" size={24} color={colors.Text03}></Icon>
                        </TouchableOpacity>
                    </View>
                </View>
                <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
                    {attachments.map((file, index) => (
                        <View style={{ marginBottom: 8 }}>
                            <FileTag key={index} file={file}></FileTag>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    )
}

export default ShowAttachmentsModal

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -4,
    },
    closeContainer: {
        height: 40,
    },
    heading: {
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
})
