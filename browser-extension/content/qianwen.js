(function() {
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log('[AI Chat Exporter - Qianwen]', ...args);
  }

  function cleanText(text) {
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  function isThinkingElement(el) {
    if (!el) return false;
    if (el.tagName === 'DETAILS') return true;
    const cls = (el.className || '').toLowerCase();
    const text = (el.textContent || '').trim();
    if (cls.includes('thinking') || cls.includes('reasoning')) return true;
    if (text.startsWith('<think>') || text.startsWith('<think>')) return true;
    return false;
  }

  function removeThinkingElements(container) {
    container.querySelectorAll('details').forEach(el => el.remove());
    container.querySelectorAll('[class*="thinking"], [class*="reasoning"], [class*="thought"]').forEach(el => el.remove());
  }

  function findBranchInfo(item) {
    if (!item) return null;

    // Strategy 1: Qwen's .qwen-chat-ui-packages-siblings-text selector
    const counter = item.querySelector('.qwen-chat-ui-packages-siblings-text');
    if (counter) {
      const match = counter.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return {
          current: parseInt(match[1]),
          total: parseInt(match[2]),
          container: counter.closest('.qwen-chat-package-comp-new-action-control-edited-container') || counter.parentElement
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
          const btns = container.querySelectorAll('button, [role="button"], svg, [class*="sibling"]');
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

      // Strategy 1: Qwen's sibling control icons
      const siblingContainer = branchInfo.container;
      if (siblingContainer) {
        // Look for SVG icons with chevron names
        const leftIcon = siblingContainer.querySelector('svg[name="icon-line-chevron-left"]');
        const rightIcon = siblingContainer.querySelector('svg[name="icon-line-chevron-right"]');

        if (direction > 0 && rightIcon) {
          const isDisabled = rightIcon.closest('[class*="disabled"]') ||
                           rightIcon.hasAttribute('disabled') ||
                           rightIcon.classList.contains('disabled');
          if (!isDisabled) {
            rightIcon.click();
            clicked = true;
          }
        } else if (direction < 0 && leftIcon) {
          const isDisabled = leftIcon.closest('[class*="disabled"]') ||
                           leftIcon.hasAttribute('disabled') ||
                           leftIcon.classList.contains('disabled');
          if (!isDisabled) {
            leftIcon.click();
            clicked = true;
          }
        }
      }

      // Strategy 2: find clickable elements (SVGs, buttons)
      if (!clicked) {
        const candidates = branchInfo.container.querySelectorAll('button, [role="button"], svg, [class*="arrow"], [class*="icon"], [class*="chevron"]');
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

    // Qwen user content
    const userContent = item.querySelector('.user-message-content');
    if (userContent) {
      text = userContent.textContent.trim();
    }

    if (!text) {
      // Fallback: try common selectors
      const contentEl = item.querySelector('[class*="user-message"], [class*="content"]');
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

    // Qwen assistant content: .response-message-content > .custom-qwen-markdown > .qwen-markdown
    const scope = item.querySelector('.response-message-content .qwen-markdown') ||
                  item.querySelector('.response-message-content') ||
                  item.querySelector('.qwen-markdown') ||
                  item.querySelector('[class*="markdown"]') ||
                  item;

    function extractInline(el) {
      let t = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          t += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const cls = node.className || '';
          const tag = node.tagName.toLowerCase();
          if (cls.includes('codespan') || tag === 'code') {
            t += '`' + node.textContent + '`';
          } else if (cls.includes('strong') || tag === 'strong' || tag === 'b') {
            t += '**' + node.textContent + '**';
          } else if (cls.includes('emphasis') || tag === 'em' || tag === 'i') {
            t += '*' + node.textContent + '*';
          } else if (cls.includes('link') || tag === 'a') {
            const href = node.getAttribute('href');
            t += href ? `[${node.textContent}](${href})` : node.textContent;
          } else if (tag === 'br') {
            t += '\n';
          } else {
            t += node.textContent;
          }
        }
      }
      return t.trim();
    }

    // Single pass: iterate all child elements in DOM order
    const walk = (node) => {
      for (const child of node.children) {
        if (isThinkingElement(child)) continue;
        if (child.closest('[class*="thinking"], [class*="reasoning"]')) continue;

        const tag = child.tagName.toLowerCase();
        const cls = child.className || '';

        // Code block
        if (tag === 'pre' || cls.includes('code-block')) {
          const ct = extractCodeBlock(child);
          if (ct) text += (text ? '\n\n' : '') + ct;
          continue;
        }

        // Table
        if (tag === 'table' || cls.includes('table')) {
          const mt = extractTable(child);
          if (mt) text += (text ? '\n\n' : '') + mt;
          continue;
        }

        // Heading
        if (/^h[1-6]$/.test(tag) || cls.includes('heading')) {
          const level = tag.startsWith('h') ? parseInt(tag.charAt(1)) : 3;
          const t = extractInline(child);
          if (t) text += (text ? '\n\n' : '') + '#'.repeat(level) + ' ' + t;
          continue;
        }

        // List (only direct children, not inside blockquote)
        if ((tag === 'ol' || tag === 'ul') && !cls.includes('blockquote')) {
          const listText = [];
          child.querySelectorAll(':scope > li').forEach((li, idx) => {
            const prefix = tag === 'ol' ? `${idx + 1}. ` : '- ';
            const t = extractInline(li);
            if (t) listText.push(prefix + t);
          });
          if (listText.length > 0) text += (text ? '\n\n' : '') + listText.join('\n');
          continue;
        }

        // Blockquote
        if (tag === 'blockquote' || cls.includes('blockquote')) {
          const inner = child.querySelector('.qwen-markdown-paragraph, p');
          if (inner) {
            const t = extractInline(inner);
            if (t) text += (text ? '\n\n' : '') + '> ' + t;
          }
          continue;
        }

        // Horizontal rule
        if (tag === 'hr' || cls.includes('hr')) {
          text += (text ? '\n\n' : '') + '---';
          continue;
        }

        // Paragraph
        if (tag === 'p' || cls.includes('paragraph')) {
          const t = extractInline(child);
          if (t) text += (text ? '\n\n' : '') + t;
          continue;
        }

        // Container divs
        if (tag === 'div' && child.children.length > 0) {
          walk(child);
          continue;
        }
      }
    };

    walk(scope);

    if (!text) {
      const cloned = item.cloneNode(true);
      removeThinkingElements(cloned);
      text = cloned.textContent.trim();
    }

    return cleanText(text);
  }

  function extractParagraphText(p) {
    return p.textContent.trim();
  }

  function extractCodeBlock(codeEl) {
    const pre = codeEl.querySelector('pre');
    if (pre) {
      const code = pre.querySelector('code');
      const codeText = code ? code.textContent : pre.textContent;
      const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
      return '```' + lang + '\n' + codeText.trim() + '\n```';
    }
    return null;
  }

  function getItemRole(item) {
    // Qwen uses specific class names
    if (item.classList.contains('qwen-chat-message-user') || item.querySelector('.user-message-content')) return 'user';
    if (item.classList.contains('qwen-chat-message-assistant') || item.querySelector('.response-message-content')) return 'assistant';
    // Fallback: check class names
    const cls = item.className || '';
    if (cls.includes('user') && !cls.includes('assistant')) return 'user';
    if (cls.includes('assistant') || cls.includes('response')) return 'assistant';
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
      const selectors = [
        '[class*="chat-title"]',
        '[class*="title"]',
        '[class*="session-name"]',
        '[class*="conversation-title"]',
        'h1',
        '[class*="header"] span',
        '[class*="sidebar"] [class*="active"]',
        '[class*="current"] [class*="title"]'
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const title = el.textContent.trim();
          if (title.length < 100) {
            log('Found title via', sel, ':', title);
            return title;
          }
        }
      }
      return null;
    },

    _getModel() {
      const modelSelectors = [
        '[class*="model-name"]',
        '[class*="modelName"]',
        '[class*="model-selector"]',
        '[class*="modelSelector"]',
        '[data-model]',
        '.model-name'
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

      return 'Qwen';
    },

    _extractMessages() {
      const messages = [];

      log('Starting message extraction...');
      log('URL:', window.location.href);

      const userMessages = document.querySelectorAll('.qwen-chat-message-user, [class*="user-message"]');
      const assistantMessages = document.querySelectorAll('.qwen-chat-message-assistant, [class*="assistant-message"]');

      log('Found', userMessages.length, 'user messages');
      log('Found', assistantMessages.length, 'assistant messages');

      if (userMessages.length > 0 || assistantMessages.length > 0) {
        const allMessages = document.querySelectorAll('.qwen-chat-message-user, .qwen-chat-message-assistant, [class*="user-message"], [class*="assistant-message"]');

        for (const msg of allMessages) {
          const isUser = msg.classList.contains('qwen-chat-message-user') ||
                        msg.className.includes('user-message');

          const content = this._extractText(msg);
          if (content) {
            messages.push({
              role: isUser ? 'user' : 'assistant',
              content: content
            });
            log('Found', isUser ? 'user' : 'assistant', 'message:', content.substring(0, 50) + '...');
          }
        }
      }

      if (messages.length === 0) {
        log('Trying fallback selectors...');
        this._fallbackExtraction(messages);
      }

      log('Final message count:', messages.length);
      return messages;
    },

    _fallbackExtraction(messages) {
      const chatContainer = document.querySelector('#chat-message-container') ||
                           document.querySelector('[class*="chat-container"]') ||
                           document.querySelector('[class*="messages"]') ||
                           document.querySelector('main');

      if (!chatContainer) {
        log('No chat container found');
        return;
      }

      const messageEls = chatContainer.querySelectorAll('[class*="message"]');
      log('Found', messageEls.length, 'message elements');

      for (const el of messageEls) {
        const classStr = el.className || '';
        const isUser = classStr.includes('user') && !classStr.includes('assistant');
        const isAssistant = classStr.includes('assistant') || classStr.includes('response');

        if (!isUser && !isAssistant) continue;

        const content = this._extractText(el);
        if (content && content.length > 5) {
          messages.push({
            role: isUser ? 'user' : 'assistant',
            content: content
          });
        }
      }
    },

    _extractText(el) {
      if (!el) return '';

      const contentSelectors = [
        '.user-message-content',
        '.response-message-content',
        '.qwen-markdown',
        '[class*="markdown"]',
        '[class*="content"]',
        '.chunked-text-renderer-root p'
      ];

      let contentEl = null;
      for (const sel of contentSelectors) {
        contentEl = el.querySelector(sel);
        if (contentEl) break;
      }

      if (!contentEl) contentEl = el;

      removeThinkingElements(contentEl);

      let text = '';

      const walk = (node) => {
        for (const child of node.children) {
          if (isThinkingElement(child)) continue;
          if (child.closest('[class*="thinking"], [class*="reasoning"]')) continue;

          const tag = child.tagName.toLowerCase();
          const cls = child.className || '';

          // Code block
          if (tag === 'pre' || cls.includes('code-block')) {
            const code = child.querySelector('code');
            const codeText = code ? code.textContent : child.textContent;
            const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
            text += (text ? '\n\n' : '') + '```' + lang + '\n' + codeText.trim() + '\n```';
            continue;
          }

          // Table
          if (tag === 'table' || cls.includes('table')) {
            const tableText = this._extractTable(child);
            if (tableText) text += (text ? '\n\n' : '') + tableText;
            continue;
          }

          // Heading
          if (/^h[1-6]$/.test(tag) || cls.includes('heading')) {
            const level = /^h[1-6]$/.test(tag) ? parseInt(tag.charAt(1)) : 3;
            const t = this._extractInlineText(child);
            if (t) text += (text ? '\n\n' : '') + '#'.repeat(level) + ' ' + t;
            continue;
          }

          // List (only direct children of markdown, not inside blockquote)
          if ((tag === 'ul' || tag === 'ol') && !cls.includes('blockquote')) {
            const items = child.querySelectorAll(':scope > li');
            const listText = [];
            items.forEach((li, idx) => {
              const prefix = tag === 'ol' ? `${idx + 1}. ` : '- ';
              const t = this._extractInlineText(li);
              if (t) listText.push(prefix + t);
            });
            if (listText.length > 0) text += (text ? '\n\n' : '') + listText.join('\n');
            continue;
          }

          // Blockquote
          if (tag === 'blockquote' || cls.includes('blockquote')) {
            const inner = child.querySelector('.qwen-markdown-paragraph, p');
            if (inner) {
              const t = this._extractInlineText(inner);
              if (t) text += (text ? '\n\n' : '') + '> ' + t;
            }
            continue;
          }

          // Horizontal rule
          if (tag === 'hr' || cls.includes('hr')) {
            text += (text ? '\n\n' : '') + '---';
            continue;
          }

          // Paragraph
          if (tag === 'p' || cls.includes('paragraph')) {
            const t = this._extractInlineText(child);
            if (t) text += (text ? '\n\n' : '') + t;
            continue;
          }

          // Container divs (custom-qwen-markdown, qwen-markdown, etc.)
          if (tag === 'div' && child.children.length > 0) {
            walk(child);
            continue;
          }
        }
      };

      walk(contentEl);

      if (!text) {
        const cloned = contentEl.cloneNode(true);
        removeThinkingElements(cloned);
        text = cloned.textContent.trim();
      }

      return cleanText(text);
    },

    _extractInlineText(el) {
      let text = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          const cls = node.className || '';

          if (cls.includes('codespan') || tag === 'code') {
            text += '`' + node.textContent + '`';
          } else if (cls.includes('strong') || tag === 'strong' || tag === 'b') {
            text += '**' + node.textContent + '**';
          } else if (cls.includes('emphasis') || tag === 'em' || tag === 'i') {
            text += '*' + node.textContent + '*';
          } else if (cls.includes('link') || tag === 'a') {
            const href = node.getAttribute('href');
            text += href ? `[${node.textContent}](${href})` : node.textContent;
          } else if (tag === 'br') {
            text += '\n';
          } else {
            text += node.textContent;
          }
        }
      }
      return text.trim();
    },

    _extractTable(tableEl) {
      const rows = [];
      tableEl.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(cell => {
          cells.push(cell.textContent.trim());
        });
        if (cells.length > 0) rows.push(cells);
      });
      if (rows.length === 0) return '';
      const header = rows[0];
      let md = '| ' + header.join(' | ') + ' |\n';
      md += '| ' + header.map(() => '---').join(' | ') + ' |\n';
      for (let i = 1; i < rows.length; i++) {
        md += '| ' + rows[i].join(' | ') + ' |\n';
      }
      return md.trim();
    },

    async _extractMessagesWithBranches() {
      const messages = [];
      log('Starting message extraction with branches...');

      // Collect all message elements
      const allMessages = document.querySelectorAll('.qwen-chat-message-user, .qwen-chat-message-assistant, [class*="user-message"], [class*="assistant-message"]');

      if (allMessages.length === 0) {
        log('No messages found, trying fallback...');
        this._fallbackExtraction(messages);
        return messages;
      }

      const seenPairs = new Set();

      for (let i = 0; i < allMessages.length; i++) {
        const el = allMessages[i];
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
        const content = this._extractText(el);
        if (content && content.length > 5) {
          const time = extractTime(el);
          messages.push({
            id: `msg-${i}`,
            role: role,
            content: content,
            time: time
          });
          log('Item', i, '->', role, ':', content.substring(0, 50) + '...');
        }
      }

      log('Final message count:', messages.length);
      return messages;
    }
  };

  log('Content script loaded');
})();
