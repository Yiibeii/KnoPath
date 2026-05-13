(function() {
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[AI Chat Exporter - Kimi]', ...args);
  }

  function cleanText(text) {
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  function isThinkingElement(el) {
    if (!el) return false;
    if (el.tagName === 'DETAILS') return true;
    const cls = (el.className || '').toLowerCase();
    if (cls.includes('thinking') || cls.includes('reasoning')) return true;
    return false;
  }

  function removeThinkingElements(container) {
    container.querySelectorAll('details').forEach(el => el.remove());
    container.querySelectorAll('[class*="thinking"], [class*="reasoning"], [class*="thought"]').forEach(el => el.remove());
  }

  function findBranchInfo(item) {
    if (!item) return null;

    // Strategy 1: Kimi's .assistant-page-info selector
    const counter = item.querySelector('.assistant-page-info');
    if (counter) {
      const match = counter.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return {
          current: parseInt(match[1]),
          total: parseInt(match[2]),
          container: counter.closest('.assistant-page') || counter.parentElement
        };
      }
    }

    // Strategy 2: find any element with "数字/数字" pattern
    const allElements = item.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length > 0) continue;
      const text = el.textContent.trim();
      const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (match) {
        let container = el.parentElement;
        for (let i = 0; i < 5 && container && container !== item; i++) {
          const btns = container.querySelectorAll('button, [role="button"], svg, .assistant-page-item');
          if (btns.length >= 2) {
            return {
              current: parseInt(match[1]),
              total: parseInt(match[2]),
              container: container
            };
          }
          container = container.parentElement;
        }
      }
    }

    return null;
  }

  async function switchToBranch(branchInfo, targetBranch) {
    if (targetBranch === branchInfo.current) return true;

    const clicksNeeded = targetBranch - branchInfo.current;
    const direction = clicksNeeded > 0 ? 1 : -1;
    const clickCount = Math.abs(clicksNeeded);

    for (let c = 0; c < clickCount; c++) {
      let clicked = false;

      // Strategy 1: Kimi's .assistant-page-item buttons
      const pageItems = branchInfo.container.querySelectorAll('.assistant-page-item');
      if (pageItems.length >= 2) {
        // First item is left arrow, second is right arrow
        const btn = direction > 0 ? pageItems[1] : pageItems[0];
        if (btn) {
          // Check if button is disabled
          const isDisabled = btn.classList.contains('disabled') ||
                           btn.hasAttribute('disabled') ||
                           btn.querySelector('[class*="disabled"]');
          if (!isDisabled) {
            btn.click();
            clicked = true;
          }
        }
      }

      // Strategy 2: find clickable elements (SVGs, buttons)
      if (!clicked) {
        const candidates = branchInfo.container.querySelectorAll('button, [role="button"], svg, [class*="arrow"], [class*="icon"]');
        const clickables = Array.from(candidates).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (clickables.length >= 2) {
          const btn = direction > 0 ? clickables[clickables.length - 1] : clickables[0];
          btn.click();
          clicked = true;
        }
      }

      if (!clicked) break;
      await new Promise(r => setTimeout(r, 200));
    }

    await new Promise(r => setTimeout(r, 300));
    return true;
  }

  function extractUserText(item) {
    let text = '';

    // Kimi user content
    const userContent = item.querySelector('.user-content');
    if (userContent) {
      text = userContent.textContent.trim();
    }

    if (!text) {
      // Fallback: try common selectors
      const contentEl = item.querySelector('[class*="content"], [class*="text"]');
      if (contentEl) {
        text = contentEl.textContent.trim();
      }
    }

    if (!text) {
      text = item.textContent.trim();
    }

    return cleanText(text);
  }

  function extractTable(tableEl) {
    const rows = [];
    tableEl.querySelectorAll('tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach(cell => {
        cells.push(cell.textContent.trim());
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length === 0) return '';

    // Use first row as header
    const header = rows[0];
    let markdown = '| ' + header.join(' | ') + ' |\n';
    markdown += '| ' + header.map(() => '---').join(' | ') + ' |\n';
    for (let i = 1; i < rows.length; i++) {
      markdown += '| ' + rows[i].join(' | ') + ' |\n';
    }
    return markdown.trim();
  }

  function extractAssistantText(item) {
    let text = '';
    removeThinkingElements(item);

    // Kimi assistant content: .markdown contains everything
    const scope = item.querySelector('.markdown') ||
                  item.querySelector('.segment-content-box') ||
                  item.querySelector('.markdown-container') ||
                  item;

    log('extractAssistantText scope:', scope.className);

    // Use a set to track processed elements and avoid duplicates
    const processed = new Set();

    // Single pass: iterate all child elements in DOM order
    const walk = (node) => {
      for (const child of node.children) {
        if (processed.has(child)) continue;
        if (isThinkingElement(child)) continue;

        const tag = child.tagName.toLowerCase();
        // Safely get class name (handle SVGAnimatedString)
        const cls = (typeof child.className === 'string') ? child.className : (child.getAttribute('class') || '');

        log('Processing child:', tag, cls.substring(0, 80));

        // Code block (.segment-code or .toolcall-container)
        if (cls.includes('segment-code') || cls.includes('toolcall-container')) {
          log('Found code block:', cls.substring(0, 80));
          processed.add(child);
          const ct = extractCodeBlock(child);
          log('Code block result:', ct ? ct.substring(0, 80) : 'null');
          if (ct) text += (text ? '\n\n' : '') + ct;
          continue;
        }

        // Table
        if (tag === 'table') {
          processed.add(child);
          const mt = extractTable(child);
          if (mt) text += (text ? '\n\n' : '') + mt;
          continue;
        }

        // Heading
        if (/^h[1-6]$/.test(tag)) {
          processed.add(child);
          const prefix = '#'.repeat(parseInt(tag.charAt(1)));
          const t = child.textContent.trim();
          if (t) text += (text ? '\n\n' : '') + prefix + ' ' + t;
          continue;
        }

        // List (not inside table)
        if ((tag === 'ol' || tag === 'ul') && !child.closest('table')) {
          processed.add(child);
          const listItems = [];
          child.querySelectorAll(':scope > li').forEach((li, idx) => {
            const prefix = tag === 'ol' ? `${idx + 1}. ` : '- ';
            const t = extractListItemText(li);
            if (t) listItems.push(prefix + t);
          });
          if (listItems.length > 0) text += (text ? '\n\n' : '') + listItems.join('\n');
          continue;
        }

        // Paragraph
        if (tag === 'p' || cls.includes('paragraph')) {
          processed.add(child);
          const t = extractParagraphText(child);
          if (t) text += (text ? '\n\n' : '') + t;
          continue;
        }

        // Div with markdown content (might contain nested paragraphs or code blocks)
        if (tag === 'div') {
          // Check if this div contains code blocks or other content
          if (child.querySelector('.segment-code, .toolcall-container, table, h1, h2, h3, h4, h5, h6, ol, ul, p, .paragraph')) {
            walk(child);
            continue;
          }
        }

        // Scroll area or other container
        if (child.children && child.children.length > 0) {
          walk(child);
        }
      }
    };

    walk(scope);

    // Fallback: find any .segment-code elements that were missed
    const allCodeBlocks = scope.querySelectorAll('.segment-code');
    for (const codeBlock of allCodeBlocks) {
      if (!processed.has(codeBlock)) {
        log('Fallback: found unprocessed code block');
        const ct = extractCodeBlock(codeBlock);
        if (ct) text += (text ? '\n\n' : '') + ct;
      }
    }

    if (!text) {
      const cloned = item.cloneNode(true);
      removeThinkingElements(cloned);
      text = cloned.textContent.trim();
    }

    log('extractAssistantText result length:', text.length);
    return cleanText(text);
  }

  function extractParagraphText(p) {
    // Simple approach: extract text with basic formatting
    let text = '';

    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName;
        const cls = node.className || '';

        // Inline code
        if (cls.includes('segment-code-inline') || tag === 'CODE') {
          text += '`' + node.textContent + '`';
        }
        // Bold
        else if (tag === 'STRONG' || tag === 'B') {
          text += '**' + node.textContent + '**';
        }
        // Italic
        else if (tag === 'EM' || tag === 'I') {
          text += '*' + node.textContent + '*';
        }
        // Links
        else if (tag === 'A') {
          const href = node.getAttribute('href');
          text += href ? `[${node.textContent}](${href})` : node.textContent;
        }
        // Other elements - just get text content
        else {
          text += node.textContent;
        }
      }
    };

    for (const child of p.childNodes) {
      processNode(child);
    }
    return text.trim();
  }

  function extractListItemText(li) {
    // Handle list items that may contain paragraphs and inline code
    const paragraph = li.querySelector('.paragraph, p');
    if (paragraph) {
      return extractParagraphText(paragraph);
    }
    // Fallback: extract all text with formatting
    let text = '';
    for (const child of li.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList.contains('segment-code-inline') || child.tagName === 'CODE') {
          text += '`' + child.textContent + '`';
        } else if (child.tagName === 'STRONG' || child.tagName === 'B') {
          text += '**' + child.textContent + '**';
        } else {
          text += child.textContent;
        }
      }
    }
    return text.trim();
  }

  function extractCodeBlock(codeEl) {
    // Same pattern as DeepSeek: find pre, get code text, find language
    const pre = codeEl.querySelector('pre');
    if (pre) {
      const code = pre.querySelector('code');
      const codeText = code ? code.textContent : pre.textContent;

      // Kimi language selector
      const langEl = codeEl.querySelector('.segment-code-lang');
      const lang = langEl ? langEl.textContent.trim() : '';

      return '```' + lang + '\n' + codeText.trim() + '\n```';
    }
    return null;
  }

  function getItemRole(item) {
    // Kimi uses .chat-content-item-user and .chat-content-item-assistant
    const cls = item.className || '';
    if (cls.includes('chat-content-item-user') || cls.includes('segment-user')) return 'user';
    if (cls.includes('chat-content-item-assistant') || cls.includes('segment-assistant')) return 'assistant';
    // Fallback: check for content elements
    if (item.querySelector('.user-content')) return 'user';
    if (item.querySelector('.markdown-container')) return 'assistant';
    return 'assistant';
  }

  function extractTime(item) {
    const timeSelectors = [
      '[class*="time"]',
      '[class*="date"]',
      '[class*="timestamp"]',
      'time',
      '[datetime]'
    ];
    for (const sel of timeSelectors) {
      const els = item.querySelectorAll(sel);
      for (const el of els) {
        const text = el.textContent.trim();
        if (text && /\d{1,2}:\d{2}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|月|日|时|分/.test(text)) {
          return text;
        }
        const dt = el.getAttribute('datetime');
        if (dt) return dt;
      }
    }
    return null;
  }

  async function extractAllBranches(item) {
    const branchInfo = findBranchInfo(item);
    if (!branchInfo || branchInfo.total <= 1) {
      return null;
    }

    log('Found message with', branchInfo.total, 'branches');

    const originalBranch = branchInfo.current;
    const allBranches = [];

    for (let targetBranch = 1; targetBranch <= branchInfo.total; targetBranch++) {
      log('Extracting branch', targetBranch);

      const currentInfo = findBranchInfo(item);
      if (currentInfo && currentInfo.current !== targetBranch) {
        await switchToBranch(currentInfo, targetBranch);
      }

      await new Promise(r => setTimeout(r, 300));

      const branchData = {
        branchId: `branch-${targetBranch}`,
        isCurrent: targetBranch === originalBranch,
        userMessage: extractUserText(item),
        assistantMessage: extractAssistantText(item)
      };

      allBranches.push(branchData);
      log('Branch', targetBranch, '- user:', branchData.userMessage.substring(0, 50), '- assistant:', branchData.assistantMessage.substring(0, 50));
    }

    log('Restoring to original branch', originalBranch);
    const finalInfo = findBranchInfo(item);
    if (finalInfo && finalInfo.current !== originalBranch) {
      await switchToBranch(finalInfo, originalBranch);
    }

    return {
      totalBranches: branchInfo.total,
      branches: allBranches,
      originalBranch: originalBranch
    };
  }

  window.__AI_CHAT_EXPORTER__ = {
    async detect() {
      const messages = this._extractMessages();
      log('Detect found', messages.length, 'messages');
      return { count: messages.length };
    },

    async export() {
      const messages = await this._extractMessagesWithBranches();
      const title = this._getTitle();
      const model = this._getModel();
      log('Export found', messages.length, 'messages, title:', title, 'model:', model);
      return { messages, title, model };
    },

    _getTitle() {
      const selectors = ['[class*="chat-title"]', '[class*="title"]', 'h1', '[class*="session-name"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const title = el.textContent.trim();
          if (title && title.length < 100) return title;
        }
      }
      return null;
    },

    _getModel() {
      const modelSelectors = [
        '[class*="model-name"]',
        '[class*="modelName"]',
        '[class*="model-selector"]',
        '[data-model]'
      ];

      for (const sel of modelSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const model = el.textContent.trim();
          if (model && model.length < 30) {
            log('Found model:', model);
            return model;
          }
        }
      }

      return 'Kimi';
    },

    _extractMessages() {
      const messages = [];
      log('Starting message extraction...');
      log('URL:', window.location.href);

      // Kimi uses .chat-content-list as container
      const chatContainer = document.querySelector('.chat-content-list') ||
                           document.querySelector('[class*="chat-content"]') ||
                           document.querySelector('[class*="chat-box"]') ||
                           document.querySelector('main') ||
                           document.body;

      log('Found chat container:', chatContainer.className || 'body');

      // Kimi uses .chat-content-item for messages
      const messageEls = chatContainer.querySelectorAll('.chat-content-item');

      log('Found', messageEls.length, 'message elements');

      for (const el of messageEls) {
        const result = this._extractSingleMessage(el);
        if (result && result.content) messages.push(result);
      }

      log('Final message count:', messages.length);
      return messages;
    },

    _extractSingleMessage(el) {
      // Kimi uses .chat-content-item-user and .chat-content-item-assistant
      const classStr = el.className || '';
      const isUser = classStr.includes('chat-content-item-user') || classStr.includes('segment-user');
      const isAssistant = classStr.includes('chat-content-item-assistant') || classStr.includes('segment-assistant');

      // Find content element
      const contentEl = el.querySelector('.user-content') ||
                       el.querySelector('.markdown-container') ||
                       el.querySelector('[class*="content"]') ||
                       el;

      const text = this._extractText(contentEl);
      if (!text || text.length < 2) return null;

      let role = isUser ? 'user' : 'assistant';
      const time = extractTime(el);
      return { role, content: text, time };
    },

    _extractText(el) {
      if (!el) return '';

      removeThinkingElements(el);

      // Try to find markdown container first
      const markdown = el.querySelector('.markdown') ||
                       el.querySelector('.user-content') ||
                       el;

      // Extract text from paragraphs and list items
      let text = '';
      const elements = markdown.querySelectorAll('p, div.paragraph, li, h1, h2, h3, h4, h5, h6');
      elements.forEach(p => {
        if (isThinkingElement(p)) return;
        const t = extractParagraphText(p);
        if (t && !text.includes(t)) text += (text ? '\n' : '') + t;
      });

      // Fallback to textContent if nothing found
      if (!text) {
        const cloned = el.cloneNode(true);
        removeThinkingElements(cloned);
        text = cloned.textContent.trim();
      }
      return cleanText(text);
    },

    async _extractMessagesWithBranches() {
      const messages = [];
      log('Starting message extraction with branches...');

      // Kimi uses .chat-content-list as container
      const chatContainer = document.querySelector('.chat-content-list') ||
                           document.querySelector('[class*="chat-content"]') ||
                           document.querySelector('[class*="chat-box"]') ||
                           document.querySelector('main') ||
                           document.body;

      // Kimi uses .chat-content-item for messages
      const messageEls = chatContainer.querySelectorAll('.chat-content-item');

      log('Found', messageEls.length, 'message elements');

      const seenPairs = new Set();

      for (let i = 0; i < messageEls.length; i++) {
        const el = messageEls[i];
        const role = getItemRole(el);

        // Check for branches on this element
        const branchInfo = findBranchInfo(el);

        if (branchInfo && branchInfo.total > 1) {
          const pairKey = `pair-${i}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          log('Processing branched message at index', i, '- found', branchInfo.total, 'branches');

          const branchData = await extractAllBranches(el);

          if (branchData && branchData.branches.length > 1) {
            const hasDifferentContent = branchData.branches.some((b, idx) => {
              if (idx === 0) return false;
              return b.userMessage !== branchData.branches[0].userMessage ||
                     b.assistantMessage !== branchData.branches[0].assistantMessage;
            });

            if (hasDifferentContent) {
              messages.push({
                id: `msg-${i}`,
                role: 'user',
                hasBranches: true,
                branches: branchData.branches
              });
              log('Added message with', branchData.branches.length, 'different branches');
              continue;
            } else {
              log('Branches have identical content, treating as single message');
            }
          }
        }

        // No branches, use standard extraction
        const result = this._extractSingleMessage(el);
        if (result && result.content) {
          messages.push({
            id: `msg-${i}`,
            role: result.role,
            content: result.content,
            time: result.time
          });
          log('Item', i, '->', result.role, ':', result.content.substring(0, 50) + '...');
        }
      }

      log('Final message count:', messages.length);
      return messages;
    }
  };

  log('Content script loaded');
})();
