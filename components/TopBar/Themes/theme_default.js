import Colors from '../../../Themes/Colors'

const ThemeColors = {
    TopBar: {
        container: {
            backgroundColor: Colors.Grey200,
        },

        // TopBarStatisticArea component
        TopBarStatisticArea: {
            // XpBar component
            XpBar: {
                bgColorDesktop: Colors.White,
                bgColorMobile: Colors.Primary350,
                thumbsUpColor: Colors.UtilityBlue200,

                container: {
                    backgroundColor: Colors.White,
                },
                bar: {
                    backgroundColor: Colors.UtilityBlue125,
                },
                filledBar: {
                    backgroundColor: Colors.Primary100,
                },
                text: {
                    color: Colors.UtilityBlue200,
                },
                levelContainer: {
                    borderColor: Colors.Primary100,
                    backgroundColor: Colors.UtilityBlue100,
                },
                level: {
                    color: Colors.Primary100,
                },
                skillContainer: {
                    borderColor: Colors.Grey350,
                    backgroundColor: Colors.UtilityRed200,
                },
                skillPoints: {
                    color: Colors.White,
                },
            },
            GoldArea: {
                container: {
                    backgroundColor: Colors.White,
                },
                containerMobile: {
                    backgroundColor: Colors.Primary350,
                },
                text: {
                    color: Colors.UtilityBlue200,
                },
            },
            TasksStatisticsArea: {
                container: {
                    backgroundColor: Colors.White,
                },
                containerMobile: {
                    backgroundColor: Colors.Primary350,
                },
                text: {
                    color: Colors.Text03,
                },
                iconColor: Colors.Text04,
                iconColorMobile: Colors.White,
                textMobile: {
                    color: Colors.White,
                },
                value: {
                    color: Colors.UtilityBlue200,
                },
                line: {
                    backgroundColor: Colors.Grey300,
                },
                lineMobile: {
                    backgroundColor: Colors.Primary400,
                },
            },
            // QuotaBar component
            QuotaBar: {
                container: {
                    backgroundColor: Colors.White,
                },
                text: {
                    color: Colors.Text03,
                },
                value: {
                    color: Colors.UtilityBlue200,
                },
                iconColor: Colors.Text04,
                iconColorMobile: Colors.White,
                containerMobile: {
                    backgroundColor: Colors.Primary350,
                },
                textMobile: {
                    color: Colors.White,
                },
            },

            // PremiumBar component
            PremiumBar: {
                desktop: {
                    container: {
                        backgroundColor: Colors.White,
                    },
                    text: {
                        color: Colors.Text03,
                    },
                },
                iconColor: Colors.Text04,
                iconColorMobile: Colors.White,
                mobile: {
                    container: {
                        backgroundColor: Colors.Primary350,
                    },
                    text: {
                        color: Colors.White,
                    },
                },
            },
        },

        // NotificationArea component
        NotificationArea: {
            iconColor: Colors.Text03,
        },
    },

    TopBarMobile: {
        settingsIcon: Colors.White,
        container: {
            backgroundColor: Colors.Primary400,
        },
        itemsContainerMobile: {
            backgroundColor: Colors.Primary400,
        },

        // TopBarMobileStatisticArea component
        TopBarMobileStatisticArea: {
            menuIcon: Colors.White,
        },

        // MobileNotificationArea component
        MobileNotificationArea: {
            searchIcon: Colors.White,
            bellIcon: Colors.White,
            moreVerticalIcon: Colors.White,
        },
    },
}

export default ThemeColors
