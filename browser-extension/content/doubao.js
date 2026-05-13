(function() {
  const DEBUG = true;
  
  function log(...args) {
    if (DEBUG) console.log('[AI Chat Exporter - Doubao]', ...args);
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

  window.__AI_CHAT_EXPORTER__ = {
    detect() {
      const messages = this._extractMessages();
      log('Detect found', messages.length, 'messages');
      return { count: messages.length };
    },

    export() {
      const messages = this._extractMessages();
      const title = this._getTitle();
      const model = this._getModel();
      log('Export found', messages.length, 'messages, title:', title, 'model:', model);
      return { messages, title, model };
    },

    _getTitle() {
      const selectors = ['[class*="title"]', 'h1', '[class*="chat-title"]', '[class*="session-title"]'];
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
      
      return 'Doubao';
    },

    _extractMessages() {
      const messages = [];
      log('Starting message extraction...');
      log('URL:', window.location.href);

      const chatContainer = document.querySelector('[class*="chat-container"]') ||
                           document.querySelector('[class*="chatContainer"]') ||
                           document.querySelector('[class*="conversation"]') ||
                           document.querySelector('[class*="messages"]') ||
                           document.querySelector('[role="log"]') ||
                           document.querySelector('main') ||
                           document.body;

      log('Chat container found:', chatContainer.className || 'body');

      const messageSelectors = [
        '[class*="message"]',
        '[class*="Message"]',
        '[class*="msg"]',
        '[class*="Msg"]',
        '[class*="chat-item"]',
        '[class*="bubble"]',
        '[data-role]'
      ];

      let messageEls = [];
      for (const sel of messageSelectors) {
        const els = chatContainer.querySelectorAll(sel);
        if (els.length > messageEls.length) {
          log('Found', els.length, 'elements via:', sel);
          messageEls = Array.from(els);
        }
      }

      if (messageEls.length === 0) {
        messageEls = Array.from(chatContainer.children);
        log('Using direct children:', messageEls.length);
      }

      for (const el of messageEls) {
        const result = this._extractSingleMessage(el);
        if (result && result.content) messages.push(result);
      }

      log('Final message count:', messages.length);
      return messages;
    },

    _extractSingleMessage(el) {
      const userIndicators = ['[class*="user"]', '[class*="User"]', '[class*="human"]', '[class*="self"]', '[data-role="user"]'];
      const assistantIndicators = ['[class*="assistant"]', '[class*="Assistant"]', '[class*="bot"]', '[class*="Bot"]', '[data-role="assistant"]'];

      let isUser = userIndicators.some(sel => el.matches(sel) || el.querySelector(sel));
      let isAssistant = assistantIndicators.some(sel => el.matches(sel) || el.querySelector(sel));

      const dataRole = el.getAttribute('data-role');
      if (dataRole) {
        isUser = dataRole === 'user';
        isAssistant = dataRole === 'assistant';
      }

      const contentSelectors = ['[class*="content"]', '[class*="text"]', '[class*="markdown"]', '.prose'];
      let contentEl = contentSelectors.reduce((found, sel) => found || el.querySelector(sel), null) || el;

      const text = this._extractText(contentEl);
      if (!text || text.length < 2) return null;

      let role = (isUser && !isAssistant) ? 'user' : 'assistant';
      return { role, content: text };
    },

    _extractText(el) {
      if (!el) return '';
      removeThinkingElements(el);
      const paragraphs = el.querySelectorAll('p, div.paragraph, li');
      let text = '';
      paragraphs.forEach(p => {
        if (isThinkingElement(p)) return;
        const t = p.textContent.trim();
        if (t && !text.includes(t)) text += (text ? '\n' : '') + t;
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
