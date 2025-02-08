import React, { useState, useEffect, useRef } from 'react';
import { Card, Form, Input, Button, Table, DatePicker, Space, InputNumber, Select, Typography, Tag } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import weekday from 'dayjs/plugin/weekday';
import localeData from 'dayjs/plugin/localeData';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import debounce from 'lodash/debounce';
import './index.css';
import Fireworks from './components/Fireworks';
import CodeSizeChart from './components/CodeSizeChart';

// 注册 dayjs 插件
dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(customParseFormat);

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface FormValues {
  group_id: string;
  gitlab_token: string;
  gitlab_api: string;
  start_date: string;
  end_date: string;
  excluded_projects: string[];
  projects_num: number;
  valid_extensions: string[];
  ignored_paths: string[];
  concurrency: number;
  date_range: [dayjs.Dayjs, dayjs.Dayjs];
}

const defaultValidExtensions = [
  '.js', '.cjs', '.mjs', '.ts', '.jsx', '.tsx', '.css',
  '.scss', '.sass', '.html', '.sh', '.vue',
  '.svelte', '.rs',
];

const defaultIgnoredPaths = [
  'dist', 'node_modules/', 'build/',
  '.husky', 'lintrc', 'public/',
];

interface CodeStat {
  key: string;
  author: string;
  email: string;
  project: string;
  commits: number;
  additions: number;
  deletions: number;
  lines: number;
  files: number;
  size: number;
  isTotal?: boolean;
  children?: CodeStat[];
}

const GitLabAnalysis: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [codeStats, setCodeStats] = useState<CodeStat[]>([]);
  const [commitStats, setCommitStats] = useState<any[]>([]);
  const [failureStats, setFailureStats] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[string, string]>(['', '']);
  const [showFireworks, setShowFireworks] = useState(false);

  // 添加防抖的滚动函数
  const smoothScrollToBottom = useRef(
    debounce((element: HTMLDivElement) => {
      element.scrollTop = element.scrollHeight;
    }, 100),
  ).current;

  // 更新滚动效果
  useEffect(() => {
    if (logContainerRef.current) {
      smoothScrollToBottom(logContainerRef.current);
    }
  }, [logs, smoothScrollToBottom]);

  // 组件卸载时清理防抖函数
  useEffect(() => () => {
    smoothScrollToBottom.cancel();
  }, [smoothScrollToBottom]);

  useEffect(() => {
    const originalConsole = {
      log: console.log,
      error: console.error,
    };

    console.log = (...args) => {
      originalConsole.log.apply(console, args);
      setLogs((prev) => [...prev, `[INFO] ${args.join(' ')}`]);
    };

    console.error = (...args) => {
      originalConsole.error.apply(console, args);
      setLogs((prev) => [...prev, `[ERROR] ${args.join(' ')}`]);
    };

    return () => {
      console.log = originalConsole.log;
      console.error = originalConsole.error;
    };
  }, []);

  const codeColumns: TableProps<any>['columns'] = [
    {
      title: '作者',
      dataIndex: 'author',
      key: 'author',
      render: (text: string, record: any) => (record.isTotal ? <strong>{text}</strong> : text),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '项目',
      dataIndex: 'project',
      key: 'project',
      render: (text: string, record: any) => (record.isTotal ? <strong>{text}</strong> : text),
    },
    {
      title: '提交次数',
      dataIndex: 'commits',
      key: 'commits',
      sorter: (a, b) => b.commits - a.commits,
      render: (text: number) => <span>{text.toLocaleString()}</span>,
    },
    {
      title: '增加行数',
      dataIndex: 'additions',
      key: 'additions',
      sorter: (a, b) => b.additions - a.additions,
      render: (text: number) => <span>{text.toLocaleString()}</span>,
    },
    {
      title: '删除行数',
      dataIndex: 'deletions',
      key: 'deletions',
      sorter: (a, b) => b.deletions - a.deletions,
      render: (text: number) => <span>{text.toLocaleString()}</span>,
    },
    {
      title: '变更行数',
      dataIndex: 'lines',
      key: 'lines',
      sorter: (a, b) => b.lines - a.lines,
      render: (text: number) => <span>{text.toLocaleString()}</span>,
    },
    {
      title: '文件数',
      dataIndex: 'files',
      key: 'files',
      sorter: (a, b) => b.files - a.files,
      render: (text: number) => <span>{text.toLocaleString()}</span>,
    },
    {
      title: '代码量(KB)',
      dataIndex: 'size',
      key: 'size',
      sorter: (a, b) => b.size - a.size,
      render: (text: number, record: any) => {
        if (record.isTotal) {
          return <Tag color="blue" key={record.key} style={{ padding: '4px 8px', fontSize: '14px' }} bordered={false}>
            {text.toFixed(2)}
          </Tag>;
        }
        return <span>{text.toFixed(2)}</span>;
      },
    },
  ];

  const commitColumns: TableProps<any>['columns'] = [
    {
      title: '作者（可筛选）',
      dataIndex: 'author',
      key: 'author',
      sorter: (a, b) => a.author.localeCompare(b.author),
      // 添加搜索功能
      filterSearch: true,
      filters: Array.from(new Set(commitStats.map((item) => item.author)))
        .map((author) => ({ text: author, value: author })),
      onFilter: (value, record) => record.author === value,
    },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '项目', dataIndex: 'project', key: 'project', width: 180 },
    { title: '分支名', dataIndex: 'branch', key: 'branch' },
    { title: '标签', dataIndex: 'tag', key: 'tag' },
    {
      title: '提交时间',
      dataIndex: 'committedDate',
      key: 'committedDate',
      width: 170,
      defaultSortOrder: 'descend',
      sorter: (a, b) => new Date(a.committedDate).getTime() - new Date(b.committedDate).getTime(),
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm'),
    },
    { title: '提交信息', dataIndex: 'message', key: 'message' },
  ];

  const failureColumns: TableProps<any>['columns'] = [
    { title: '项目', dataIndex: 'project_name', key: 'project' },
    { title: '作者', dataIndex: 'author', key: 'author' },
    { title: '操作', dataIndex: 'operation', key: 'operation' },
    { title: 'URL', dataIndex: 'url', key: 'url' },
    { title: '错误信息', dataIndex: 'error', key: 'error' },
  ];

  const handleAnalyze = async (values: FormValues) => {
    try {
      setLoading(true);
      setLogs([]);
      console.log('开始分析...');

      const dateRange = values.date_range;
      const startDate = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
      const endDate = dateRange[1].format('YYYY-MM-DD HH:mm:ss');

      setDateRange([startDate, endDate]);

      const config = {
        gitlab_api: values.gitlab_api,
        gitlab_token: values.gitlab_token,
        group_id: values.group_id,
        start_date: startDate,
        end_date: endDate,
        projects_num: values.projects_num,
        excluded_projects: values.excluded_projects || [],
        valid_extensions: values.valid_extensions,
        ignored_paths: values.ignored_paths,
        max_concurrent_requests: values.concurrency,
      };

      // eslint-disable-next-line @typescript-eslint/naming-convention
      // 因为要先重写console实现滚动日志效果，所以需要动态导入
      const { analyze_gitlab_projects } = await import('@gogors/gitlab-analysis-wasm');

      const result = await analyze_gitlab_projects(config);

      // 对每个作者的子项目进行排序
      const sortedCodeStats = result.codeStats.map((authorStats: CodeStat) => {
        if (authorStats.children) {
          return {
            ...authorStats,
            children: authorStats.children.sort((a: CodeStat, b: CodeStat) => b.size - a.size),
          };
        }
        return authorStats;
      });

      // 对作者总计行进行排序
      const finalCodeStats = sortedCodeStats.sort((a: CodeStat, b: CodeStat) => b.size - a.size);

      // 设置展开状态
      const allKeys = finalCodeStats
        .filter((item: CodeStat) => item.children && item.children.length > 0)
        .map((item: CodeStat) => item.key);

      setCodeStats(finalCodeStats);
      setExpandedKeys(allKeys);
      setCommitStats(result.commitStats || []);
      setFailureStats(result.failureStats || []);
      console.log('分析完成！');
      setShowFireworks(true);
    } catch (error) {
      console.error('分析失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={'container'}>
      <div className={'formWrapper'}>
        <Card className={'formCard'}>
          <Title level={2}>GitLab 代码分析</Title>
          <Form
            form={form}
            layout="vertical"
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            onFinish={handleAnalyze}
            initialValues={{
              group_id: '2177',
              gitlab_token: '',
              gitlab_api: '',
              date_range: [dayjs().subtract(7, 'days'), dayjs()],
              projects_num: 100,
              concurrency: 20,
              valid_extensions: defaultValidExtensions,
              ignored_paths: defaultIgnoredPaths,
              excluded_projects: [],
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Form.Item
                name="gitlab_api"
                label="GitLab API 地址"
                tooltip="GitLab API 地址"
                rules={[{ required: true, message: '请输入 GitLab API 地址' }]}
              >
                <Input placeholder="请输入 GitLab API 地址" />
              </Form.Item>

              <Form.Item
                name="gitlab_token"
                label="GitLab Token"
                tooltip="GitLab 访问令牌"
                rules={[{ required: true, message: '请输入 GitLab Token' }]}
              >
                <Input.Password placeholder="请输入 GitLab Token" />
              </Form.Item>

              <Form.Item
                name="group_id"
                label="项目组Group ID"
                tooltip="GitLab 项目组 ID"
                rules={[{ required: true, message: '请输入项目组Group ID' }]}
              >
                <Input placeholder="请输入 Group ID" />
              </Form.Item>

              <Form.Item
                name="date_range"
                label="日期范围"
                tooltip="统计的时间范围，默认为最近一周"
                rules={[{ required: true, message: '请选择日期范围' }]}
              >
                <RangePicker
                  style={{ width: '100%' }}
                  onChange={(dates) => {
                    if (dates) {
                      form.setFieldsValue({
                        start_date: dates[0]?.format('YYYY-MM-DD'),
                        end_date: dates[1]?.format('YYYY-MM-DD'),
                      });
                    }
                  }}
                />
              </Form.Item>

              <Form.Item
                name="excluded_projects"
                label="排除的项目"
                tooltip="不需要统计的项目名称"
              >
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  placeholder="请输入要排除的项目名称"
                />
              </Form.Item>

              <Form.Item
                name="projects_num"
                label="项目数量限制"
                tooltip="最多统计最近活跃的项目数量，默认 100"
                rules={[{ required: true, message: '请输入项目数量限制' }]}
              >
                <InputNumber min={1} max={100} style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item
                name="valid_extensions"
                label="统计包含的文件类型"
                tooltip="需要统计的文件类型，默认前端相关文件"
                rules={[{ required: true, message: '请输入统计包含的文件类型' }]}
              >
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  placeholder="请输入有效的文件扩展名"
                />
              </Form.Item>

              <Form.Item
                name="ignored_paths"
                label="忽略的路径和文件"
                tooltip="不需要统计的文件路径"
              >
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  placeholder="请输入要忽略的路径"
                />
              </Form.Item>

              <Form.Item
                name="concurrency"
                label="并发数"
                tooltip="考虑服务器qps，设置同时发起的请求数量，默认 20，失败率过高时请降低并发数"
              >
                <InputNumber min={1} max={30} style={{ width: '100%' }} />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                className={'submitButton'}
              >
                开始分析
              </Button>
            </Space>
          </Form>
        </Card>

      </div>


      <Card
        title="执行日志"
        className={'logCard'}
        extra={
          <Button
            type="link"
            onClick={() => setLogs([])}
            disabled={logs.length === 0}
          >
            清空日志
          </Button>
        }
      >
        <div className={'logContainer'} ref={logContainerRef}>
          {logs.length === 0 ? (
            <div className={'emptyLog'}>暂无日志</div>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                className={`logLine ${log.includes('[ERROR]') ? 'errorLog' : ''}`}
              >
                {log}
              </div>
            ))
          )}
        </div>
      </Card>

      <Card
        title={
          dateRange[0] && dateRange[1]
            ? `代码统计（${dateRange[0]} 至 ${dateRange[1]}）`
            : `代码统计（${dayjs().subtract(7, 'days')
              .format('YYYY-MM-DD HH:mm:ss')} 至 ${dayjs().format('YYYY-MM-DD HH:mm:ss')}）`
        }
        className={'tableCard'}
      >
        <Table
          columns={codeColumns}
          dataSource={codeStats}
          loading={loading}
          scroll={{ x: true }}
          rowKey="key"
          pagination={false}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys as string[]),
            expandRowByClick: true,
          }}
          className="code-stats-table"
        />
        {codeStats.length > 0 && <CodeSizeChart data={codeStats} />}
      </Card>
      <Card title={
        dateRange[0] && dateRange[1]
          ? `提交统计（${dateRange[0]} 至 ${dateRange[1]}）`
          : `提交统计（${dayjs().subtract(7, 'days')
            .format('YYYY-MM-DD HH:mm:ss')} 至 ${dayjs().format('YYYY-MM-DD HH:mm:ss')}）`
      }
        className={'tableCard'}>
        <Table
          columns={commitColumns}
          dataSource={commitStats}
          loading={loading}
          scroll={{ x: true }}
          pagination={{
            pageSize: 30,
            showSizeChanger: false,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`,
          }}
          rowKey={(record) => `${record.email}_${record.project}_${record.committedDate}`}
        />
      </Card>

      {failureStats.length > 0 && (
        <Card title="错误统计" className={'tableCard'}>
          <Table
            columns={failureColumns}
            dataSource={failureStats}
            loading={loading}
            scroll={{ x: true }}
            rowKey={(record) => `${record.project_name}_${record.author_email}_${record.url}`}
          />
        </Card>
      )}

      {showFireworks && (
        <Fireworks
          duration={3000}
          onComplete={() => setShowFireworks(false)}
        />
      )}

      <div className="footer">
        <div>
          Powered by{' '}
          <Tag color="#e6d6f9">Rust</Tag>
          <Tag color="#E6F7FF">WebAssembly</Tag>
          <Tag color="#F0F5FF">React</Tag>
          <Tag color="#F6FFED">Ant Design</Tag>
          <Tag color="#FFF7E6">AI</Tag>
        </div>
        <div style={{ marginTop: '8px' }}>
          Author: <a href="mailto:yululiu2018@gmail.com">yululiu2018@gmail.com</a>
        </div>
      </div>
    </div>
  );
};

export default GitLabAnalysis;
