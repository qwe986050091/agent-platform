import { useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Divider,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Upload,
} from 'antd'
import { CloudUploadOutlined, DeleteOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import { api } from '../api'
import assistantAvatar from '../assets/assistant-avatar.jpg'

interface Skill {
  name: string
  shortDescription: string
  detailedDescription: string
  systemPrompt: string
  builtin: boolean
  mounted: boolean
  createdBy: string
  toolNames: string[]
  /** 技能类型：tool（普通技能包，默认）| agent（子代理：独立循环 + 私有工具） */
  type?: string
}

interface SkillFormValues {
  name: string
  type?: string
  shortDescription?: string
  detailedDescription?: string
  systemPrompt?: string
  toolNames?: string[]
}

export default function SkillsPage() {
  const { message } = AntdApp.useApp()
  const [skills, setSkills] = useState<Skill[]>([])
  const [tools, setTools] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<SkillFormValues>()

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [skillData, toolData] = await Promise.all([
        api<{ skills: Skill[] }>('/api/skills'),
        api<{ tools: string[] }>('/api/skills/tools'),
      ])
      setSkills(skillData.skills || [])
      setTools(toolData.tools || [])
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ========== 上传：表单 JSON ==========
  async function handleFormSubmit(values: SkillFormValues) {
    setSubmitting(true)
    try {
      await api('/api/skills/upload', {
        method: 'POST',
        body: {
          name: values.name.trim(),
          type: values.type || 'tool',
          shortDescription: values.shortDescription || '',
          detailedDescription: values.detailedDescription || '',
          systemPrompt: values.systemPrompt || '',
          toolNames: values.toolNames || [],
        },
      })
      message.success(`Skill「${values.name.trim()}」上传成功`)
      form.resetFields()
      await loadAll()
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ========== 上传：.json 文件 ==========
  const uploadProps: UploadProps = {
    accept: '.json,application/json',
    maxCount: 1,
    showUploadList: false,
    customRequest: async (options) => {
      const { file, onSuccess, onError } = options
      try {
        const fd = new FormData()
        fd.append('file', file as File)
        await api('/api/skills/upload', { method: 'POST', body: fd })
        message.success(`文件「${(file as File).name}」上传成功`)
        onSuccess?.({}, new XMLHttpRequest())
        await loadAll()
      } catch (err: any) {
        message.error(err.message)
        onError?.(err)
      }
    },
  }

  // ========== 挂载 / 卸载 / 删除 ==========
  async function toggleMount(skill: Skill) {
    try {
      if (skill.mounted) {
        await api('/api/skills/unmount', { method: 'POST', body: { skillName: skill.name } })
        message.success(`已卸载「${skill.name}」`)
      } else {
        await api('/api/skills/mount', { method: 'POST', body: { skillName: skill.name } })
        message.success(`已挂载「${skill.name}」`)
      }
      await loadAll()
    } catch (err: any) {
      message.error(err.message)
    }
  }

  async function removeSkill(skill: Skill) {
    try {
      await api(`/api/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' })
      message.success(`已删除「${skill.name}」`)
      await loadAll()
    } catch (err: any) {
      message.error(err.message)
    }
  }

  return (
    <div className="skills-page">
      <Spin spinning={loading}>
        {/* 全部技能 */}
        <Card title="全部技能" className="skills-panel">
          {skills.length === 0 ? (
            <Empty
              image={<img className="empty-illust" src={assistantAvatar} alt="" />}
              imageStyle={{ height: 'auto' }}
              description="还没有技能，上传一个试试吧"
            />
          ) : (
          <div className="skills-grid">
            {skills.map((s) => (
              <Card
                key={s.name}
                size="small"
                className={`skill-card ${s.mounted ? 'mounted' : ''}`}
                title={
                  <Space size={6} wrap>
                    <span>{s.name}</span>
                    {s.builtin ? (
                      <Tag color="default">内置</Tag>
                    ) : (
                      <Tag color="gold">自定义</Tag>
                    )}
                    {s.type === 'agent' && <Tag color="purple">子代理</Tag>}
                    {s.mounted && <Tag color="geekblue">已挂载</Tag>}
                  </Space>
                }
                extra={
                  <Space size={6}>
                    <Button
                      size="small"
                      type={s.mounted ? 'default' : 'primary'}
                      onClick={() => toggleMount(s)}
                    >
                      {s.mounted ? '卸载' : '挂载'}
                    </Button>
                    {!s.builtin && (
                      <Popconfirm
                        title={`确定删除 Skill「${s.name}」？`}
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        cancelText="取消"
                        onConfirm={() => removeSkill(s)}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </Space>
                }
              >
                <p className="skill-card-desc">{s.shortDescription || '（无描述）'}</p>
                {s.toolNames?.length > 0 && (
                  <p className="skill-card-tools">
                    Tools：
                    {s.toolNames.map((t) => (
                      <Tag key={t} style={{ marginTop: 4 }}>
                        {t}
                      </Tag>
                    ))}
                  </p>
                )}
              </Card>
            ))}
          </div>
          )}
        </Card>

        {/* 上传新技能 */}
        <Card title="上传新技能" className="skills-panel">
          <Upload.Dragger {...uploadProps} style={{ padding: 8 }}>
            <p className="ant-upload-drag-icon">
              <CloudUploadOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽 Skill JSON 文件到此处上传</p>
            <p className="ant-upload-hint">文件格式为 SkillDefinition JSON（含 name / type / systemPrompt / toolNames 等字段；type 缺省为 tool）</p>
          </Upload.Dragger>

          <Divider titlePlacement="start" plain>
            或在线填写表单
          </Divider>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleFormSubmit}
            requiredMark="optional"
            style={{ maxWidth: 640 }}
          >
            <Form.Item
              name="name"
              label="技能名称"
              rules={[{ required: true, message: '请输入技能名称' }]}
            >
              <Input placeholder="如 weather_time_report" />
            </Form.Item>
            <Form.Item
              name="type"
              label="技能类型"
              initialValue="tool"
              extra="tool=普通技能包（工具直挂主 Agent）；agent=子代理（独立推理循环 + 私有工具，主 Agent 以委派/并行扇出方式调用）"
            >
              <Select
                options={[
                  { value: 'tool', label: '普通技能包（tool）' },
                  { value: 'agent', label: '子代理（agent）' },
                ]}
              />
            </Form.Item>
            <Form.Item name="shortDescription" label="短描述">
              <Input placeholder="一句话说明技能用途" />
            </Form.Item>
            <Form.Item name="detailedDescription" label="详细描述">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="systemPrompt" label="系统提示词（System Prompt）">
              <Input.TextArea
                rows={4}
                placeholder="告诉模型这个技能该按什么流程使用工具"
              />
            </Form.Item>
            <Form.Item name="toolNames" label="关联内置工具">
              <Checkbox.Group
                options={tools.map((t) => ({ label: t, value: t }))}
                disabled={tools.length === 0}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting}>
                上传技能
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Spin>
    </div>
  )
}
