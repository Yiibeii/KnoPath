(function() {
  const DEBUG = true;
  
  function log(...args) {
    if (DEBUG) console.log('[AI Chat Exporter - DeepSeek]', ...args);
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
    // Remove <details> elements (DeepSeek R1 thinking blocks)
    container.querySelectorAll('details').forEach(el => el.remove());
    // Remove elements with thinking-related class names
    container.querySelectorAll('[class*="thinking"], [class*="reasoning"], [class*="thought"]').forEach(el => el.remove());
    // Remove <summary> elements with thinking text
    container.querySelectorAll('summary').forEach(el => {
      const text = el.textContent.toLowerCase();
      if (text.includes('thinking') || text.includes('思考') || text.includes('推理') || text.includes('深度思考')) {
        el.closest('details')?.remove() || el.remove();
      }
    });
  }

  async function scrollToCollectAllMessages() {
    const container = document.querySelector('.ds-virtual-list-items') ||
                     document.querySelector('[class*="virtual-list"]') ||
                     document.documentElement;

    const collectedMessages = [];
    const seenKeys = new Set();
    let lastHeight = 0;
    let noChangeCount = 0;
    const maxAttempts = 100;

    log('Starting scroll to collect all messages...');

    // Scroll to bottom first to trigger loading
    for (let i = 0; i < maxAttempts; i++) {
      container.scrollTop = container.scrollHeight;
      await new Promise(r => setTimeout(r, 400));

      const items = document.querySelectorAll('[data-virtual-list-item-key]');
      items.forEach(item => {
        const key = item.getAttribute('data-virtual-list-item-key');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          const role = getItemRole(item);
          const content = role === 'assistant'
            ? extractAssistantText(item)
            : extractUserText(item);
          if (content && content.length > 0) {
            collectedMessages.push({ key, role, content, time: extractTime(item) });
          }
        }
      });

      log('Attempt', i + 1, '- Collected:', collectedMessages.length, 'messages');

      if (container.scrollHeight === lastHeight) {
        noChangeCount++;
        if (noChangeCount >= 3) break;
      } else {
        noChangeCount = 0;
        lastHeight = container.scrollHeight;
      }
    }

    // Scroll back to top to catch any missed items
    for (let i = 0; i < maxAttempts; i++) {
      container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight);
      await new Promise(r => setTimeout(r, 300));

      const items = document.querySelectorAll('[data-virtual-list-item-key]');
      items.forEach(item => {
        const key = item.getAttribute('data-virtual-list-item-key');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          const role = getItemRole(item);
          const content = role === 'assistant'
            ? extractAssistantText(item)
            : extractUserText(item);
          if (content && content.length > 0) {
            collectedMessages.push({ key, role, content, time: extractTime(item) });
          }
        }
      });

      if (container.scrollTop <= 0) break;
    }

    // Sort by key order
    collectedMessages.sort((a, b) => {
      const keyA = parseInt(a.key) || 0;
      const keyB = parseInt(b.key) || 0;
      return keyA - keyB;
    });

    log('Scroll complete. Total collected:', collectedMessages.length);
    return collectedMessages;
  }

  function findBranchInfo(item) {
    if (!item) return null;

    // Strategy 1: original selectors
    const counter = item.querySelector('.dd7e4fda');
    if (counter) {
      const match = counter.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return {
          current: parseInt(match[1]),
          total: parseInt(match[2]),
          container: counter.closest('._17e14c5') || counter.parentElement
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
          const btns = container.querySelectorAll('button, [role="button"], svg');
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

      // Strategy 1: original selectors
      const dsButtons = branchInfo.container.querySelectorAll('.ds-icon-button');
      if (dsButtons.length >= 2) {
        const btn = direction > 0 ? dsButtons[1] : dsButtons[0];
        if (btn && !btn.classList.contains('ds-icon-button--disabled')) {
          btn.click();
          clicked = true;
        }
      }

      // Strategy 2: find clickable elements (buttons, SVGs, icons)
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
    const branchCounter = item.querySelector('.dd7e4fda');
    const branchContainer = item.querySelector('._17e14c5');

    let text = '';

    const fileNames = item.querySelectorAll('.f3a54b52');
    fileNames.forEach(f => {
      const name = f.textContent.trim();
      if (name) text += `[附件: ${name}]\n`;
    });

    const dsMessage = item.querySelector('.ds-message');
    if (dsMessage) {
      const allText = dsMessage.textContent.trim();

      const excludeElements = item.querySelectorAll('.f3a54b52, ._5119742, .dd7e4fda, ._17e14c5, .ds-icon-button');
      let cleanContent = allText;
      excludeElements.forEach(el => {
        cleanContent = cleanContent.replace(el.textContent.trim(), '');
      });

      cleanContent = cleanContent.trim();
      if (cleanContent) {
        text += cleanContent;
      }
    }

    if (!text) {
      let rawText = item.textContent.trim();

      if (branchContainer) {
        rawText = rawText.replace(branchContainer.textContent.trim(), '');
      } else if (branchCounter) {
        rawText = rawText.replace(branchCounter.textContent.trim(), '');
      }

      const arrows = item.querySelectorAll('.ds-icon-button');
      arrows.forEach(arrow => {
        rawText = rawText.replace(arrow.textContent.trim(), '');
      });

      text = rawText.trim();
    }

    return text;
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

    // Find header row
    const headerCells = tableEl.querySelectorAll('th');
    let headerIdx = -1;
    if (headerCells.length > 0) {
      const firstRow = rows[0];
      headerIdx = 0;
      let markdown = '| ' + firstRow.join(' | ') + ' |\n';
      markdown += '| ' + firstRow.map(() => '---').join(' | ') + ' |\n';
      for (let i = 1; i < rows.length; i++) {
        markdown += '| ' + rows[i].join(' | ') + ' |\n';
      }
      return markdown.trim();
    }

    // No <th> found, use first row as header
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

    const scope = item.querySelector('.ds-assistant-message-main-content') || item;

    // Single pass: iterate all child elements in DOM order
    const walk = (node) => {
      for (const child of node.children) {
        if (isThinkingElement(child)) continue;
        if (child.closest('[class*="thinking"], [class*="reasoning"]')) continue;

        const tag = child.tagName.toLowerCase();

        // Code block
        if (child.classList.contains('md-code-block')) {
          const ct = extractCodeBlock(child);
          if (ct) text += (text ? '\n\n' : '') + ct;
          continue;
        }

        // Table
        if (tag === 'table') {
          const mt = extractTable(child);
          if (mt) text += (text ? '\n\n' : '') + mt;
          continue;
        }

        // Heading
        if (/^h[1-6]$/.test(tag)) {
          const prefix = '#'.repeat(parseInt(tag.charAt(1)));
          const t = child.textContent.trim();
          if (t) text += (text ? '\n\n' : '') + prefix + ' ' + t;
          continue;
        }

        // List (not inside table)
        if ((tag === 'ol' || tag === 'ul') && !child.closest('table')) {
          const listItems = [];
          child.querySelectorAll(':scope > li').forEach((li, idx) => {
            const prefix = tag === 'ol' ? `${idx + 1}. ` : '- ';
            const t = li.textContent.trim();
            if (t) listItems.push(prefix + t);
          });
          if (listItems.length > 0) text += (text ? '\n\n' : '') + listItems.join('\n');
          continue;
        }

        // Paragraph
        if (tag === 'p') {
          const t = extractParagraphText(child);
          if (t) text += (text ? '\n\n' : '') + t;
          continue;
        }

        // Div with markdown content (might contain nested paragraphs)
        if (tag === 'div' && child.querySelector('p')) {
          walk(child);
          continue;
        }

        // Scroll area or other container
        if (child.children && child.children.length > 0) {
          walk(child);
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
    const spans = p.querySelectorAll('span');
    if (spans.length > 0) {
      let text = '';
      spans.forEach(s => {
        const t = s.textContent.trim();
        if (t) text += t;
      });
      return text;
    }
    return p.textContent.trim();
  }

  function extractCodeBlock(codeEl) {
    const pre = codeEl.querySelector('pre');
    if (pre) {
      const code = pre.querySelector('code');
      const codeText = code ? code.textContent : pre.textContent;
      
      const langEl = codeEl.querySelector('.d813de27');
      const lang = langEl ? langEl.textContent.trim() : '';
      
      return '```' + lang + '\n' + codeText.trim() + '\n```';
    }
    return null;
  }

  function getItemRole(item) {
    return item.querySelector('.ds-markdown-paragraph, .md-code-block') ? 'assistant' : 'user';
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

  async function extractAllBranches(item, itemKey) {
    const branchInfo = findBranchInfo(item);
    if (!branchInfo || branchInfo.total <= 1) {
      return null;
    }

    log('Found message with', branchInfo.total, 'branches at key', itemKey);

    const originalBranch = branchInfo.current;
    const allBranches = [];
    let sharedTime = extractTime(item);

    // Find the assistant item by looking for the next sibling with assistant content
    let assistantItem = null;
    let nextSibling = item.nextElementSibling;
    for (let i = 0; i < 3 && nextSibling; i++) {
      if (getItemRole(nextSibling) === 'assistant') {
        assistantItem = nextSibling;
        break;
      }
      nextSibling = nextSibling.nextElementSibling;
    }

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
        assistantMessage: '',
        time: sharedTime
      };

      if (!branchData.time) branchData.time = extractTime(item);

      // Re-find assistant item after branch switch (DOM may have changed)
      let switchedAssistant = null;
      nextSibling = item.nextElementSibling;
      for (let i = 0; i < 3 && nextSibling; i++) {
        if (getItemRole(nextSibling) === 'assistant') {
          switchedAssistant = nextSibling;
          break;
        }
        nextSibling = nextSibling.nextElementSibling;
      }

      if (switchedAssistant) {
        branchData.assistantMessage = extractAssistantText(switchedAssistant);
        if (!branchData.time) branchData.time = extractTime(switchedAssistant);
      } else if (assistantItem) {
        branchData.assistantMessage = extractAssistantText(assistantItem);
        if (!branchData.time) branchData.time = extractTime(assistantItem);
      }

      if (!sharedTime && branchData.time) sharedTime = branchData.time;

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
      const collected = await scrollToCollectAllMessages();
      log('Detect found', collected.length, 'messages');
      return { count: collected.length };
    },

    async export() {
      const collected = await scrollToCollectAllMessages();
      const messages = await this._extractMessagesWithBranches(collected);
      const title = this._getTitle();
      const model = this._getModel();
      log('Export found', messages.length, 'messages');
      return { messages, title, model };
    },

    _getTitle() {
      const selectors = [
        '[class*="chat-title"]',
        '[class*="title-text"]',
        'h1',
        '[class*="conversation-title"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const title = el.textContent.trim();
          if (title && title.length < 100 && title.length > 0) {
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
        '[data-model]'
      ];
      
      for (const sel of modelSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const model = el.textContent.trim();
          if (model && model.length < 30 && model.length > 0) {
            return model;
          }
        }
      }
      
      return 'DeepSeek-V3';
    },

    _extractMessages() {
      const messages = [];
      log('Starting message extraction...');

      const items = document.querySelectorAll('[data-virtual-list-item-key]');
      log('Found', items.length, 'virtual list items');

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = item.getAttribute('data-virtual-list-item-key');
        const role = getItemRole(item);

        const content = role === 'assistant'
          ? extractAssistantText(item)
          : extractUserText(item);

        if (content && content.length > 0) {
          messages.push({ role, content });
          log('Item', key, '->', role, ':', content.substring(0, 50) + '...');
        }
      }

      log('Final message count:', messages.length);
      return messages;
    },

    async _extractMessagesWithBranches(collected) {
      const messages = [];
      log('Starting message extraction with branches...');

      const items = collected || [];
      log('Using', items.length, 'collected messages');

      for (let i = 0; i < items.length; i++) {
        const itemData = items[i];
        const { key, role, content, time } = itemData;

        // Need to scroll to this item to check for branches
        const container = document.querySelector('.ds-virtual-list-items') ||
                         document.querySelector('[class*="virtual-list"]') ||
                         document.documentElement;
        let domItem = document.querySelector(`[data-virtual-list-item-key="${key}"]`);
        if (!domItem) {
          const estimatedPos = (parseInt(key) / (parseInt(items[items.length - 1]?.key) || 1)) * container.scrollHeight;
          container.scrollTop = estimatedPos;
          await new Promise(r => setTimeout(r, 400));
          domItem = document.querySelector(`[data-virtual-list-item-key="${key}"]`);
        }

        if (domItem) {
          const branchInfo = findBranchInfo(domItem);

          if (branchInfo && branchInfo.total > 1) {
            log('Processing branched message at key', key, '- found', branchInfo.total, 'branches');

            const branchData = await extractAllBranches(domItem, key);

            if (branchData && branchData.branches.length > 1) {
              const hasDifferentContent = branchData.branches.some((b, idx) => {
                if (idx === 0) return false;
                return b.userMessage !== branchData.branches[0].userMessage ||
                       b.assistantMessage !== branchData.branches[0].assistantMessage;
              });

              if (hasDifferentContent) {
                messages.push({
                  id: `msg-${key}`,
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
        }

        // No branches, use collected content
        if (content && content.length > 0) {
          messages.push({
            id: `msg-${key}`,
            role: role,
            content: content,
            time: time
          });
          log('Item', key, '->', role, ':', content.substring(0, 50) + '...');
        }
      }

      log('Final message count:', messages.length);
      return messages;
    }
  };

  log('Content script loaded');
})();
