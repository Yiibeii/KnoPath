(function() {
  const DEBUG = true;
  
  function log(...args) {
    if (DEBUG) console.log('[AI Chat Exporter - Claude]', ...args);
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

  window.__AI_CHAT_EXPORTER__ = {
    detect() {
      const messages = this._extractMessages();
      log('Detect found', messages.length, 'messages');
      return { count: messages.length };
    },

    export() {
      const messages = this._extractMessages();
      const title = this._getTitle();
      log('Export found', messages.length, 'messages, title:', title);
      return { messages, title };
    },

    _getTitle() {
      const selectors = ['h1', '[class*="title"]', '[class*="conversation-title"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const title = el.textContent.trim();
          if (title && title.length < 100) return title;
        }
      }
      return null;
    },

    _extractMessages() {
      const messages = [];
      log('Starting message extraction...');
      log('URL:', window.location.href);

      const chatSelectors = [
        '[class*="conversation"]',
        '[class*="messages-container"]',
        '[class*="chat-messages"]',
        '[role="log"]',
        'main'
      ];

      let chatContainer = null;
      for (const sel of chatSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          log('Found chat container via:', sel);
          chatContainer = el;
          break;
        }
      }
      if (!chatContainer) chatContainer = document.body;

      const messageSelectors = [
        '[class*="human"]',
        '[class*="assistant"]',
        '[class*="message"]',
        '[data-testid*="message"]'
      ];

      let messageEls = [];
      for (const sel of messageSelectors) {
        const els = chatContainer.querySelectorAll(sel);
        if (els.length > 0) {
          log('Found', els.length, 'elements via:', sel);
          messageEls = messageEls.concat(Array.from(els));
        }
      }

      messageEls = [...new Set(messageEls)];
      log('Unique message elements:', messageEls.length);

      for (const el of messageEls) {
        const result = this._extractSingleMessage(el);
        if (result && result.content) messages.push(result);
      }

      if (messages.length === 0) {
        log('Trying fallback: direct children');
        const children = chatContainer.children;
        for (let i = 0; i < children.length; i++) {
          const el = children[i];
          const text = el.textContent.trim();
          if (text.length > 10) {
            messages.push({
              role: i % 2 === 0 ? 'user' : 'assistant',
              content: cleanText(text)
            });
          }
        }
      }

      log('Final message count:', messages.length);
      return messages;
    },

    _extractSingleMessage(el) {
      const isHuman = el.matches('[class*="human"]') || 
                     el.querySelector('[class*="human"]') ||
                     el.getAttribute('data-testid')?.includes('human');
      
      const isAssistant = el.matches('[class*="assistant"]') ||
                         el.querySelector('[class*="assistant"]') ||
                         el.getAttribute('data-testid')?.includes('assistant');

      const contentSelectors = [
        '[class*="markdown"]',
        '.markdown-body',
        '[class*="content"]',
        '[class*="message-content"]',
        '.prose'
      ];

      let contentEl = null;
      for (const sel of contentSelectors) {
        contentEl = el.querySelector(sel);
        if (contentEl) break;
      }
      if (!contentEl) contentEl = el;

      const text = this._extractText(contentEl);
      if (!text || text.length < 2) return null;

      let role = 'assistant';
      if (isHuman && !isAssistant) role = 'user';
      else if (isAssistant && !isHuman) role = 'assistant';

      return { role, content: text };
    },

    _extractText(el) {
      if (!el) return '';

      removeThinkingElements(el);

      const paragraphs = el.querySelectorAll('p');
      const codeBlocks = el.querySelectorAll('pre');

      let text = '';
      paragraphs.forEach(p => {
        if (isThinkingElement(p)) return;
        const t = p.textContent.trim();
        if (t) text += (text ? '\n' : '') + t;
      });

      codeBlocks.forEach(pre => {
        if (isThinkingElement(pre)) return;
        const code = pre.querySelector('code');
        const codeText = code ? code.textContent : pre.textContent;
        text += `\n\`\`\`\n${codeText.trim()}\n\`\`\`\n`;
      });

      if (!text) {
        const cloned = el.cloneNode(true);
        removeThinkingElements(cloned);
        text = cloned.textContent.trim();
      }
      return cleanText(text);
    }
  };

  log('Content script loaded');
})();
