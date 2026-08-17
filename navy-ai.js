(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error(
      'The Navy AI extension must be loaded unsandboxed, because it needs to make network requests to api.navy.'
    );
  }

  const API_ENDPOINT = 'https://api.navy/v1/chat/completions';

  class NavyAIExtension {
    constructor() {
      this.token = '';
      this.model = '';
      this.systemRole = '';
      this.maxTokens = 256;
      this.temperature = 1;
      this.seed = 0;
      this.history = []; // extra {role, content} messages beyond the system role
      this.lastResponseText = '';
      this.lastErrorText = '';
      this.waitingCount = 0;
    }

    getInfo() {
      return {
        id: 'navyai',
        name: 'Navy AI',
        color1: '#000080',
        color2: '#00005C',
        color3: '#0000A8',
        blocks: [
          {
            opcode: 'setToken',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set token to [TOKEN]',
            arguments: {
              TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: 'sk-xxxxx' }
            }
          },
          {
            opcode: 'setModel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set model to [MODEL]',
            arguments: {
              MODEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'gpt-4o-mini' }
            }
          },
          '---',
          {
            opcode: 'setSystemRole',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set system role [ROLE]',
            arguments: {
              ROLE: { type: Scratch.ArgumentType.STRING, defaultValue: 'You are a concise release assistant.' }
            }
          },
          {
            opcode: 'setMaxTokens',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set max tokens [NUM]',
            arguments: {
              NUM: { type: Scratch.ArgumentType.NUMBER, defaultValue: 256 }
            }
          },
          {
            opcode: 'setTemperature',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set temperature to [TEMP]',
            arguments: {
              TEMP: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.9 }
            }
          },
          {
            opcode: 'setSeed',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set seed to [SEED]',
            arguments: {
              SEED: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          '---',
          {
            opcode: 'addToHistory',
            blockType: Scratch.BlockType.COMMAND,
            text: 'add [MESSAGE] to [ROLE] in history',
            arguments: {
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' },
              ROLE: { type: Scratch.ArgumentType.STRING, menu: 'roleMenu', defaultValue: 'user' }
            }
          },
          {
            opcode: 'clearHistory',
            blockType: Scratch.BlockType.COMMAND,
            text: 'clear history'
          },
          '---',
          {
            opcode: 'prompt',
            blockType: Scratch.BlockType.COMMAND,
            text: 'prompt [MESSAGE]',
            arguments: {
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Write three product taglines.' }
            }
          },
          {
            opcode: 'promptAndWait',
            blockType: Scratch.BlockType.REPORTER,
            text: 'prompt [MESSAGE] and wait',
            arguments: {
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Write three product taglines.' }
            }
          },
          '---',
          {
            opcode: 'lastResponse',
            blockType: Scratch.BlockType.REPORTER,
            text: 'last response'
          },
          {
            opcode: 'lastError',
            blockType: Scratch.BlockType.REPORTER,
            text: 'last error'
          },
          {
            opcode: 'isWaiting',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'waiting for response?'
          }
        ],
        menus: {
          roleMenu: {
            acceptReporters: true,
            items: ['system', 'user']
          }
        }
      };
    }

    // ---- setters ----

    setToken(args) {
      this.token = Scratch.Cast.toString(args.TOKEN);
    }

    setModel(args) {
      this.model = Scratch.Cast.toString(args.MODEL);
    }

    setSystemRole(args) {
      this.systemRole = Scratch.Cast.toString(args.ROLE);
    }

    setMaxTokens(args) {
      this.maxTokens = Scratch.Cast.toNumber(args.NUM);
    }

    setTemperature(args) {
      this.temperature = Scratch.Cast.toNumber(args.TEMP);
    }

    setSeed(args) {
      this.seed = Scratch.Cast.toNumber(args.SEED);
    }

    // ---- history ----

    addToHistory(args) {
      const role = Scratch.Cast.toString(args.ROLE) === 'system' ? 'system' : 'user';
      this.history.push({ role, content: Scratch.Cast.toString(args.MESSAGE) });
    }

    clearHistory() {
      // Clears added history, but keeps the system role set via "set system role".
      this.history = [];
    }

    // ---- status reporters ----

    lastResponse() {
      return this.lastResponseText;
    }

    lastError() {
      return this.lastErrorText;
    }

    isWaiting() {
      return this.waitingCount > 0;
    }

    // ---- internals ----

    _buildMessages() {
      const messages = [];
      if (this.systemRole) {
        messages.push({ role: 'system', content: this.systemRole });
      }
      for (const entry of this.history) {
        messages.push(entry);
      }
      return messages;
    }

    async _sendPrompt(message) {
      if (!this.token) {
        this.lastErrorText = 'No token set. Use the "set token" block first.';
        return '';
      }

      this.history.push({ role: 'user', content: message });
      this.waitingCount++;

      const body = {
        model: this.model || 'gpt-4o-mini',
        messages: this._buildMessages(),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        seed: this.seed
      };

      try {
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content =
          data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
            ? data.choices[0].message.content
            : '';

        this.history.push({ role: 'assistant', content });
        this.lastResponseText = content;
        this.lastErrorText = '';
        return content;
      } catch (err) {
        this.lastErrorText = err && err.message ? err.message : String(err);
        return '';
      } finally {
        this.waitingCount--;
      }
    }

    // ---- prompt blocks ----

    prompt(args) {
      // Fires the request but does NOT block the script.
      // Check "waiting for response?" or "last response" to pick up the result.
      this._sendPrompt(Scratch.Cast.toString(args.MESSAGE));
    }

    promptAndWait(args) {
      // Blocks the script until the response comes back, then reports it directly.
      return this._sendPrompt(Scratch.Cast.toString(args.MESSAGE));
    }
  }

  Scratch.extensions.register(new NavyAIExtension());
})(Scratch);
