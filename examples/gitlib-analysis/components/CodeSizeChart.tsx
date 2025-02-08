import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { CodeStat } from '../types';

interface CodeSizeChartProps {
  data: CodeStat[];
}

const CodeSizeChart: React.FC<CodeSizeChartProps> = ({ data }) => {
  const chartData = useMemo(() => {
    return data
      .filter(item => item.isTotal)
      .sort((a, b) => b.size - a.size)
      .map(item => ({
        name: item.author.replace(/[【】]/g, ''),
        value: Number(item.size.toFixed(2))
      }));
  }, [data]);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: (params: any) => {
        const data = params[0];
        return `${data.name}: ${data.value} KB`;
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: chartData.map(item => item.name),
      axisLabel: {
        interval: 0,
        rotate: 45
      }
    },
    yAxis: {
      type: 'value',
      name: '代码量(KB)',
      nameTextStyle: {
        color: '#666'
      }
    },
    series: [
      {
        name: '代码量',
        type: 'bar',
        data: chartData,
        barWidth: '50px',
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#096dd940' },
              { offset: 1, color: '#ff181840' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        },
        label: {
          show: true,
          position: 'top',
          formatter: '{c} KB'
        }
      }
    ]
  };

  return (
    <div style={{
      marginTop: 16,
      display: 'flex',
      justifyContent: 'center'
    }}>
      <ReactECharts
        option={option}
        style={{
          height: '400px',
          width: `${Math.max(600, chartData.length * 100)}px`
        }}
        opts={{ renderer: 'svg' }}
      />
    </div>
  );
};

export default CodeSizeChart; 