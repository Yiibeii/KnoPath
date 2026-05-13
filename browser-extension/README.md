# AI Chat Exporter 浏览器扩展

一键导出豆包、Kimi、DeepSeek、千问、ChatGPT、Claude 等平台的对话记录。

## 支持平台

| 平台 | 网址 | 状态 |
|------|------|------|
| 豆包 | doubao.com | ✅ |
| Kimi | kimi.moonshot.cn | ✅ |
| DeepSeek | chat.deepseek.com | ✅ |
| 通义千问 | tongyi.aliyun.com | ✅ |
| ChatGPT | chat.openai.com | ✅ |
| Claude | claude.ai | ✅ |

## 🚀 快速安装

### 方式一：打开安装页面（推荐）

双击打开 [install.html](install.html)，按照页面指引操作即可。

### 方式二：手动安装

#### Chrome / Edge

1. 打开浏览器扩展管理页面：
   - Chrome: 地址栏输入 `chrome://extensions/`
   - Edge: 地址栏输入 `edge://extensions/`

2. 开启 **"开发者模式"**

3. 点击 **"加载已解压的扩展程序"**

4. 选择 `browser-extension` 文件夹

#### Firefox

1. 打开 `about:debugging`
2. 点击 **"此 Firefox"** → **"临时载入附加组件"**
3. 选择 `manifest.json` 文件

### 生成图标

首次安装需要生成图标文件：

1. 打开 [generate-icons.html](generate-icons.html)
2. 点击按钮下载 3 个 PNG 图标
3. 将图标保存到 `icons/` 文件夹

## 使用方法

1. 打开支持的 AI 对话网站（如豆包、Kimi 等）
2. 进入一个对话页面
3. 点击浏览器工具栏的扩展图标
4. 选择导出格式：
   - **KnoPath JSON**: 适合导入 KnoPath 项目
   - **Chat Export 格式**: 通用对话导出格式
   - **Markdown**: 适合阅读和编辑
   - **纯文本**: 最简单的格式
5. 点击 **"导出当前对话"**

## 导出格式说明

### KnoPath JSON 格式

```json
{
  "nodes": [
    {
      "question": "用户问题",
      "answer": "AI回答",
      "summary": "",
      "context": ""
    }
  ]
}
```

可直接导入 KnoPath 项目使用。

### Chat Export 格式

兼容 ChatGPT 导出格式，可用于其他工具。

## 导入到 KnoPath

1. 在 KnoPath Explore 视图，点击工具栏的 **上传** 按钮
2. 选择导出的 JSON 文件
3. 自动创建项目并导入对话

## 常见问题

### Q: 为什么检测不到对话？

A: 请确保：
- 当前页面是支持的网站
- 已打开一个具体的对话（不是首页）
- 页面已完全加载

### Q: 导出的内容不完整？

A: 不同网站的 DOM 结构可能变化。如果遇到问题：
1. 尝试刷新页面后重新导出
2. 在 GitHub 提 Issue，附上网站名称

### Q: 支持 Firefox 吗？

A: 支持，但需要使用 Firefox 临时加载方式。正式发布后会支持 Firefox Add-ons。

## 开发说明

### 目录结构

```
browser-extension/
├── manifest.json      # 扩展配置
├── install.html       # 安装指引页面
├── popup.html         # 弹窗界面
├── popup.js           # 弹窗逻辑
├── popup.css          # 样式 (KnoPath 绿色主题)
├── generate-icons.html # 图标生成器
├── content/           # 各平台内容脚本
│   ├── doubao.js
│   ├── kimi.js
│   ├── deepseek.js
│   ├── qianwen.js
│   ├── chatgpt.js
│   └── claude.js
└── icons/             # 图标
    ├── icon.svg
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 添加新平台支持

1. 在 `manifest.json` 中添加 `host_permissions` 和 `content_scripts`
2. 在 `content/` 目录创建新的内容脚本
3. 在 `popup.js` 的 `PLATFORMS` 对象中添加平台信息

内容脚本模板：

```javascript
window.__AI_CHAT_EXPORTER__ = {
  detect() {
    const messages = this._extractMessages();
    return { count: messages.length };
  },

  export() {
    const messages = this._extractMessages();
    const title = this._getTitle();
    return { messages, title };
  },

  _getTitle() {
    // 返回对话标题
  },

  _extractMessages() {
    // 返回消息数组: [{ role: 'user'|'assistant', content: '...' }]
  }
};
```

## License

MIT
