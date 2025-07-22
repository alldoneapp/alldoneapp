import React, { useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import 'chartjs-adapter-moment'
import Chart from 'chart.js/auto'
import { colors } from '../../styles/global'
import ChartDataLabels from 'chartjs-plugin-datalabels'
Chart.register(ChartDataLabels)

export default function StackedBarChart({ title, statisticData, project }) {
    const { data, unit } = statisticData
    const [dataset, setDataset] = useState([
        {
            label: 'Alldone',
            data: [{ x: 0, y: 0 }],
            backgroundColor: '#ffffff',
        },
    ])
    const [suggestedMax, setSuggestedMax] = useState(100)

    const getSuggestedMax = newDataset => {
        const maxValues = {}

        for (let set of newDataset) {
            for (let i in set.data) {
                if (maxValues[set.data[i].x]) {
                    maxValues[set.data[i].x] += set.data[i].y
                } else {
                    maxValues[set.data[i].x] = set.data[i].y
                }
            }
        }

        const sug = Math.max(...Object.values(maxValues)) * 1.15
        setSuggestedMax(sug)
    }

    useEffect(() => {
        const newDataset = project
            ? [
                  {
                      label: project.name,
                      data: data,
                      backgroundColor: project.color,
                  },
              ]
            : data.map(project => {
                  return {
                      label: project.name,
                      data: project.data,
                      backgroundColor: project.color,
                  }
              })

        setDataset(newDataset)
        getSuggestedMax(newDataset)
    }, [JSON.stringify(statisticData)])

    return (
        <Bar
            options={{
                plugins: {
                    title: {
                        display: true,
                        text: title,
                        color: colors.Text03,
                        font: {
                            family: 'Roboto-Regular',
                            size: 14,
                        },
                    },
                    legend: {
                        labels: {
                            boxWidth: 20,
                            filter: (legendItem, data) => {
                                return (
                                    data?.datasets?.[legendItem.datasetIndex]?.data?.reduce(
                                        (total, dataItem) => total + dataItem.y,
                                        0
                                    ) !== 0
                                )
                            },
                        },
                    },
                    datalabels: {
                        color: colors.Text03,
                        formatter: (value, ctx) => {
                            let total = 0
                            let index = ctx.dataIndex
                            dataset.map((d, i) => {
                                total += d.data[index].y
                            })
                            return total
                        },
                        align: 'end',
                        anchor: 'end',
                        display: function (context) {
                            return context.datasetIndex === dataset.length - 1
                        },
                    },
                },
                responsive: true,
                // maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: unit },
                        display: dataset?.[0]?.data.length <= 14,
                        stacked: true,
                        ticks: { source: 'data', autoSkip: false, maxRotation: 0, major: { enabled: true } },
                    },
                    y: {
                        stacked: true,
                        suggestedMax: suggestedMax,
                    },
                },
            }}
            data={{
                datasets: dataset,
            }}
            type={'bar'}
        />
    )
}
