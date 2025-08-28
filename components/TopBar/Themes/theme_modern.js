import Colors from '../../../Themes/Colors'

const ThemeColors = {
    TopBar: {
        container: {
            backgroundColor: Colors.GraySidebar,
            shadowColor: 'rgba(4, 20, 47, 0.24)',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 6,
            elevation: 3,
        },

        // TopBarStatisticArea component
        TopBarStatisticArea: {
            // XpBar component
            XpBar: {
                bgColorDesktop: Colors.White,
                bgColorMobile: Colors.White,
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
                    backgroundColor: Colors.White,
                },
                text: {
                    color: Colors.Text03,
                },
            },
            TasksStatisticsArea: {
                container: {
                    backgroundColor: Colors.White,
                },
                containerMobile: {
                    backgroundColor: Colors.White,
                },
                text: {
                    color: Colors.Text03,
                },
                iconColor: Colors.Text04,
                iconColorMobile: Colors.Text04,
                textMobile: {
                    color: Colors.Text03,
                },
                value: {
                    color: Colors.UtilityBlue200,
                },
                line: {
                    backgroundColor: Colors.Grey300,
                },
                lineMobile: {
                    backgroundColor: Colors.Grey300,
                },
            },
            // QuotaBar component
            QuotaBar: {
                container: {
                    backgroundColor: Colors.White,
                },
                iconColor: Colors.Text04,
                iconColorMobile: Colors.Text04,
                text: {
                    color: Colors.Text03,
                },
                value: {
                    color: Colors.UtilityBlue200,
                },
                containerMobile: {
                    backgroundColor: Colors.White,
                },
                textMobile: {
                    color: Colors.Text03,
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
                iconColorMobile: Colors.Text04,
                mobile: {
                    container: {
                        backgroundColor: Colors.White,
                    },
                    text: {
                        color: Colors.Text03,
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
        settingsIcon: Colors.Text03,
        container: {
            backgroundColor: Colors.GraySidebar,
        },
        itemsContainerMobile: {
            backgroundColor: Colors.GraySidebar,
        },

        // TopBarMobileStatisticArea component
        TopBarMobileStatisticArea: {
            menuIcon: Colors.Text03,
        },

        // MobileNotificationArea component
        MobileNotificationArea: {
            searchIcon: Colors.Text03,
            bellIcon: Colors.Text03,
            moreVerticalIcon: Colors.Text03,
        },
    },
}

export default ThemeColors
