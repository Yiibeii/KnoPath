(function() {
  const DEBUG = true;
  
  function log(...args) {
    if (DEBUG) console.log('[AI Chat Exporter - ChatGPT]', ...args);
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
      const selectors = ['h1', '[class*="title"]', '[class*="thread-title"]'];
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

      const messageEls = document.querySelectorAll('[data-message-author-role]');
      log('Found', messageEls.length, 'elements with data-message-author-role');

      for (const el of messageEls) {
        const role = el.getAttribute('data-message-author-role');
        const contentEl = el.querySelector('[class*="markdown"]') || el.querySelector('.markdown') || el.querySelector('[class*="content"]');
        
        if (contentEl && role) {
          const text = this._extractText(contentEl);
          if (text) {
            messages.push({
              role: role === 'user' ? 'user' : 'assistant',
              content: text
            });
          }
        }
      }

      if (messages.length === 0) {
        log('Trying fallback selectors...');
        const chatContainer = document.querySelector('[class*="react-scroll-to-bottom"]') ||
                             document.querySelector('[class*="conversation"]') ||
                             document.querySelector('main');
        
        if (chatContainer) {
          const allMessages = chatContainer.querySelectorAll('[class*="message"]');
          log('Found', allMessages.length, 'message elements');
          
          for (const el of allMessages) {
            const isUser = el.matches('[class*="user"]') || el.querySelector('[class*="user-avatar"]');
            const contentEl = el.querySelector('[class*="markdown"]') || el.querySelector('[class*="content"]');
            
            if (contentEl) {
              const text = this._extractText(contentEl);
              if (text) {
                messages.push({
                  role: isUser ? 'user' : 'assistant',
                  content: text
                });
              }
            }
          }
        }
      }

      log('Final message count:', messages.length);
      return messages;
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
