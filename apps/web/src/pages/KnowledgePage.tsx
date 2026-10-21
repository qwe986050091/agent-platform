import { useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  List,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import type { UploadProps } from 'antd'
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type KnowledgeDoc,
} from '../api'
import assistantAvatar from '../assets/assistant-avatar.jpg'

/**
 * 知识库管理页
 *
 * 上传 txt/md/PDF/Word/Excel/PPT/HTML 文档 → backend 转发 Agent 侧：
 * 二进制文档由 Tika 抽取正文，随后切块并向量化存入向量库；
 * 对话时 Agent 会自动检索这些文档片段（RAG），回答里可引用文档内容。
 */
export default function KnowledgePage() {
  const { message, notification } = AntdApp.useApp()
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadDocs()
  }, [])

  async function loadDocs() {
    setLoading(true)
    try {
      setDocs(await listDocuments())
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ========== 上传文档 ==========
  const uploadProps: UploadProps = {
    accept: '.txt,.md,.text,.markdown,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm',
    multiple: false,
    showUploadList: false,
    customRequest: async (options) => {
      const { file, onSuccess, onError } = options
      const f = file as File
      // 同一条通知持续更新：上传进度 → 服务端处理 → 成功/失败
      const key = `knowledge-upload-${Date.now()}`

      const showProgress = (percent: number) => {
        const processing = percent >= 100
        notification.open({
          key,
          placement: 'bottomRight',
          duration: 0,
          message: processing ? '正在处理文档' : `正在上传《${f.name}》`,
          description: (
            <div>
              <Progress
                percent={processing ? 100 : percent}
                status={processing ? 'active' : 'normal'}
                showInfo={!processing}
                size="small"
              />
              {processing && (
                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                  文件已上传，正在切块并向量化（首次处理可能需要十几秒）…
                </div>
              )}
            </div>
          ),
        })
      }

      if (f.size > 20 * 1024 * 1024) {
        notification.error({
          key,
          placement: 'bottomRight',
          duration: 5,
          message: '文件过大',
          description: `《${f.name}》大小为 ${(f.size / 1024 / 1024).toFixed(1)}MB，超过 20MB 上限`,
        })
        onError?.(new Error('文件超过 20MB 上限'))
        return
      }

      showProgress(0)
      try {
        const result = await uploadDocument(f, showProgress)
        notification.success({
          key,
          placement: 'bottomRight',
          duration: 4,
          message: '上传成功',
          description: `《${f.name}》已切分为 ${result.chunks} 个片段，对话时可被检索引用`,
        })
        onSuccess?.({}, new XMLHttpRequest())
        await loadDocs()
      } catch (err: any) {
        notification.error({
          key,
          placement: 'bottomRight',
          duration: 5,
          message: '上传失败',
          description: err.message,
        })
        onError?.(err)
      }
    },
  }

  async function removeDoc(doc: KnowledgeDoc) {
    try {
      await deleteDocument(doc.id)
      message.success(`已删除「${doc.docName}」`)
      await loadDocs()
    } catch (err: any) {
      message.error(err.message)
    }
  }

  return (
    <div className="skills-page">
      <Spin spinning={loading}>
        {/* 上传文档 */}
        <Card title="上传知识文档" className="skills-panel">
          <Upload.Dragger {...uploadProps} style={{ padding: 8 }}>
            <p className="ant-upload-drag-icon">
              <CloudUploadOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文档到此处上传</p>
            <p className="ant-upload-hint">
              支持 txt / md / PDF / Word / Excel / PPT / HTML，单个文件最大 20MB；
              上传后自动抽取正文、切分、向量化，对话时可被 AI 检索引用
            </p>
          </Upload.Dragger>
        </Card>

        {/* 文档列表 */}
        <Card title={`我的知识库（${docs.length}）`} className="skills-panel">
          {docs.length === 0 ? (
            <Empty
              image={<img className="empty-illust" src={assistantAvatar} alt="" />}
              imageStyle={{ height: 'auto' }}
              description="还没有知识文档，上传一个试试吧"
            />
          ) : (
            <List
              itemLayout="horizontal"
              dataSource={docs}
              renderItem={(doc) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="del"
                      title={`确定删除文档「${doc.docName}」？`}
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => removeDoc(doc)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<FileTextOutlined style={{ fontSize: 22 }} />}
                    title={
                      <Space size={8} wrap>
                        <Typography.Text strong>{doc.docName}</Typography.Text>
                        <Tag color="geekblue">{doc.docType}</Tag>
                        <Tag>{doc.chunkCount} 片段</Tag>
                      </Space>
                    }
                    description={
                      doc.createdAt
                        ? `上传于 ${new Date(doc.createdAt).toLocaleString('zh-CN')}`
                        : ''
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Spin>
    </div>
  )
}