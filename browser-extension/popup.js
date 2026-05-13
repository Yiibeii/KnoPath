const PLATFORMS = {
  doubao: {
    name: '豆包',
    host: ['doubao.com', 'www.doubao.com'],
    color: '#00d4aa',
    defaultModel: 'Doubao'
  },
  kimi: {
    name: 'Kimi',
    host: ['kimi.moonshot.cn', 'kimi.com', 'www.kimi.com'],
    color: '#6366f1',
    defaultModel: 'Kimi'
  },
  deepseek: {
    name: 'DeepSeek',
    host: ['chat.deepseek.com'],
    color: '#4d6bfe',
    defaultModel: 'DeepSeek-V3'
  },
  qianwen: {
    name: '通义千问',
    host: ['tongyi.aliyun.com', 'qianwen.aliyun.com', 'chat.qwen.ai', 'qianwen.com', 'www.qianwen.com'],
    color: '#ff6a00',
    defaultModel: 'Qwen'
  },
  chatgpt: {
    name: 'ChatGPT',
    host: ['chat.openai.com'],
    color: '#10a37f',
    defaultModel: 'GPT-4'
  },
  claude: {
    name: 'Claude',
    host: ['claude.ai'],
    color: '#cc785c',
    defaultModel: 'Claude'
  }
};

function detectPlatform(hostname) {
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    if (platform.host.some(h => hostname === h || hostname.endsWith('.' + h))) {
      return { key, ...platform };
    }
  }
  return null;
}

function setStatus(text, type = 'default') {
  const statusBox = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  statusText.textContent = text;
  statusBox.className = 'status-box';
  if (type !== 'default') {
    statusBox.classList.add(type);
  }
}

function showPlatformInfo(platform) {
  const info = document.getElementById('platform-info');
  const name = document.getElementById('platform-name');
  info.style.display = 'flex';
  name.textContent = platform.name;
  name.style.color = platform.color;
}

function showChatInfo(count) {
  const info = document.getElementById('chat-info');
  const countEl = document.getElementById('chat-count');
  info.style.display = 'block';
  countEl.textContent = count;
}

function enableButtons(enable) {
  document.getElementById('btn-export').disabled = !enable;
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}

function formatAsKnoPath(messages, title, model, platform) {
  const nodes = [];
  let currentQuestion = null;
  let currentTime = new Date().toISOString();

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentQuestion && currentQuestion.content) {
        nodes.push({
          question: currentQuestion.content,
          answer: '',
          time: currentTime,
          model: model || platform?.defaultModel || 'Unknown',
          branches: currentQuestion.branches || undefined
        });
      }

      if (msg.hasBranches && msg.branches) {
        // Find the branch with the most content as the default
        const bestBranch = msg.branches.find(b => b.isCurrent && b.assistantMessage) ||
                          msg.branches.find(b => b.assistantMessage) ||
                          msg.branches[0];
        currentQuestion = {
          content: bestBranch.userMessage || '',
          branches: msg.branches.map(b => ({
            question: b.userMessage || '',
            answer: b.assistantMessage || '',
            time: b.time || null
          }))
        };
      } else {
        currentQuestion = {
          content: msg.content || ''
        };
      }

      if (msg.time) currentTime = msg.time;
    } else if (msg.role === 'assistant') {
      if (currentQuestion) {
        const node = {
          question: currentQuestion.content,
          time: msg.time || currentTime,
          model: model || platform?.defaultModel || 'Unknown'
        };

        if (currentQuestion.branches) {
          node.branches = currentQuestion.branches;
          // Use the best branch (with content) as the default answer
          const bestBranch = currentQuestion.branches.find(b => b.answer && b.answer.length > 5) ||
                            currentQuestion.branches[0];
          node.answer = bestBranch?.answer || '';
        } else {
          node.answer = msg.content || '';
        }

        nodes.push(node);
        currentQuestion = null;
      } else {
        nodes.push({
          question: 'Untitled',
          answer: msg.content || '',
          time: msg.time || currentTime,
          model: model || platform?.defaultModel || 'Unknown'
        });
      }
    }
  }

  if (currentQuestion && currentQuestion.content) {
    nodes.push({
      question: currentQuestion.content,
      answer: '',
      time: currentTime,
      model: model || platform?.defaultModel || 'Unknown',
      branches: currentQuestion.branches || undefined
    });
  }

  return {
    title: title || 'Untitled Chat',
    model: model || platform?.defaultModel || 'Unknown',
    platform: platform?.name || 'Unknown',
    time: new Date().toISOString(),
    nodes
  };
}

function formatAsMarkdown(messages, title) {
  let md = `# ${title || 'Exported Chat'}\n\n`;
  for (const msg of messages) {
    if (msg.role === 'user') {
      md += `## User\n\n${msg.content}\n\n`;
    } else {
      md += `## Assistant\n\n${msg.content}\n\n`;
    }
  }
  return md;
}

function getFilename(format, title) {
  const date = new Date().toISOString().slice(0, 10);
  const safeTitle = (title || 'chat').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').slice(0, 50);
  const ext = format === 'markdown' ? 'md' : 'json';
  return `chat-${safeTitle}-${date}.${ext}`;
}

async function exportChat() {
  const format = document.getElementById('format').value;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  const platform = detectPlatform(url.hostname);

  setStatus('正在加载完整对话...', 'default');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      if (window.__AI_CHAT_EXPORTER__) {
        return await window.__AI_CHAT_EXPORTER__.export();
      }
      return null;
    }
  });

  const data = results[0].result;
  if (!data || !data.messages || data.messages.length === 0) {
    setStatus('未找到对话内容', 'error');
    return;
  }

  const title = data.title || 'Exported Chat';
  const messages = data.messages;
  const model = data.model || platform?.defaultModel;

  let content, filename;

  switch (format) {
    case 'knopath':
      content = formatAsKnoPath(messages, title, model, platform);
      filename = getFilename('json', title);
      downloadJSON(content, filename);
      break;
    case 'markdown':
      content = formatAsMarkdown(messages, title);
      filename = getFilename('markdown', title);
      downloadMarkdown(content, filename);
      break;
  }

  setStatus(`已导出 ${messages.length} 条消息`, 'success');
}

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  const platform = detectPlatform(url.hostname);

  if (!platform) {
    setStatus('当前页面不支持', 'error');
    return;
  }

  setStatus('正在检测对话...', 'default');
  showPlatformInfo(platform);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        if (window.__AI_CHAT_EXPORTER__) {
          return await window.__AI_CHAT_EXPORTER__.detect();
        }
        return null;
      }
    });

    const info = results[0].result;
    if (info && info.count > 0) {
      setStatus('检测成功', 'success');
      showChatInfo(info.count);
      enableButtons(true);
    } else {
      setStatus('未检测到对话，请打开一个对话', 'warning');
    }
  } catch (err) {
    setStatus('检测失败: ' + err.message, 'error');
  }
});

document.getElementById('btn-export').addEventListener('click', () => exportChat());
