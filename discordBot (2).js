// Name: DiscordBot
// Author: Mistium (Modified for Embed & REST Pre-upload Attachment Support)
// Description: Make discord bots in turbowarp

// License: MPL-2.0
// This Source Code is subject to the terms of the Mozilla Public License, v2.0,
// If a copy of the MPL was not distributed with this file,
// Then you can obtain one at https://mozilla.org/MPL/2.0/

(function(Scratch) {
  const API = 'https://apps.mistium.com/discord';
  const WS = 'wss://gateway.discord.gg/?v=10&encoding=json';

  // Optional CORS relay for the attachment-upload PUT step (see
  // cors-upload-proxy-worker.js). The /channels/{id}/attachments PUT goes
  // directly to a Google Cloud Storage URL whose CORS policy doesn't allow
  // browser origins like TurboWarp, so it gets blocked unless relayed
  // through a server you control. Leave this as '' to upload directly
  // (works in non-browser/unsandboxed contexts); set it to your deployed
  // worker's /proxy endpoint, e.g.:
  // 'https://my-cors-relay.YOURNAME.workers.dev/proxy?url='
  const UPLOAD_PROXY = 'https://cors.ernestoguevarahuezo.workers.dev/proxy?url=';

  let bot_data = null;
  
  const util = {
    s: val => Scratch.Cast.toString(val),
    log: console.log,
    err: console.error,
    limit: (arr, max) => { while (arr.length > max) arr.shift(); }
  };

  class DiscordBot {
    constructor() {
      this.token = null;
      this.client = null;
      this.messages = [];
      this.interactions = [];
      this.status = "online";
      this.activity = null;
      
      this.messageCache = new Map();
      this.maxCachePerChannel = 100;
      this.guildCache = new Map();
      
      this.conn = {
        isConnecting: false,
        attempts: 0,
        maxAttempts: 10,
        reconnectTimer: null,
        heartbeatTimer: null,
        seq: null,
        sessionId: null,
        rateLimited: false,
        rateLimitReset: 0
      };
    }

    getInfo() {
      return {
        id: 'mistiumDiscordBot',
        name: 'DiscordBot',
        description: 'A Discord bot for Scratch with Embed and REST API Attachment support',
        color1: "#7289DA",
        blocks: [
          // ========================
          //      Connection
          // ========================
          {
            opcode: 'setToken',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set token to [TOKEN] (THIS ALLOWS FULL ACCESS TO YOUR BOT, DO NOT SHARE EVER)',
            arguments: {
              TOKEN: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'token'
              }
            }
          },
          {
            opcode: 'connectToDiscord',
            blockType: Scratch.BlockType.COMMAND,
            text: 'connect to discord',
          },
          {
            opcode: 'disconnectFromDiscord',
            blockType: Scratch.BlockType.COMMAND,
            text: 'disconnect from discord',
          },
          {
            opcode: 'connected', 
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'connected to discord',
          },
          {
            opcode: 'botinfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'bot information',
          },
          {
            opcode: 'getGuilds',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get all guilds',
          },
          {
            opcode: 'getGuildInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get guild info [GUILD_ID]',
            arguments: {
              GUILD_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'guild_id'
              }
            }
          },
          
          '---',
          
          // ========================
          //       Messages
          // ========================
          {
            opcode: 'sendMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'send message [MESSAGE] to channel [CHANNEL]',
            arguments: {
              MESSAGE: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message'
              },
              CHANNEL: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel'
              }
            }
          },
          {
            opcode: 'getMessage',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get message [MESSAGE_ID] from channel [CHANNEL_ID]',
            arguments: {
              MESSAGE_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message_id'
              },
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          {
            opcode: 'getChannelMessages',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get last [AMOUNT] messages from channel [CHANNEL_ID]',
            arguments: {
              AMOUNT: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 10
              },
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          {
            opcode: 'sendDirectMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'DM user [USER_ID] message [MESSAGE]',
            arguments: {
              USER_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'user_id'
              },
              MESSAGE: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message'
              }
            }
          },
          {
            opcode: 'deleteMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              MESSAGE_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message_id'
              },
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          {
            opcode: 'sendReply',
            blockType: Scratch.BlockType.COMMAND,
            text: 'send reply [REPLY] to message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              REPLY: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'reply'
              },
              MESSAGE_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message_id'
              },
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          {
            opcode: 'addReaction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'add reaction [EMOJI] to message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              EMOJI: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'emoji'
              },
              MESSAGE_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message_id'
              },
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          {
            opcode: 'removeReaction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'remove reaction [EMOJI] from message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              EMOJI: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'emoji'
              },
              MESSAGE_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'message_id'
              },
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          
          '---',
          
          // ========================
          //     Embed Builder
          // ========================
          {
            opcode: 'createEmbed',
            blockType: Scratch.BlockType.REPORTER,
            text: 'create embed',
          },
          {
            opcode: 'createEmbedList',
            blockType: Scratch.BlockType.REPORTER,
            text: 'create embed list',
          },
          {
            opcode: 'addEmbedToList',
            blockType: Scratch.BlockType.REPORTER,
            text: 'add embed [EMBED] to list [LIST]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              LIST: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }
            }
          },
          {
            opcode: 'setEmbedTitle',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set title of embed [EMBED] to [TITLE] with link [URL]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              TITLE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Title' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }
            }
          },
          {
            opcode: 'setEmbedDescription',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set description of embed [EMBED] to [DESCRIPTION]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              DESCRIPTION: { type: Scratch.ArgumentType.STRING, defaultValue: 'Description' }
            }
          },
          {
            opcode: 'setEmbedColor',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set color of embed [EMBED] to [COLOR]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              COLOR: { type: Scratch.ArgumentType.STRING, defaultValue: '#7289DA' }
            }
          },
          {
            opcode: 'setEmbedFooter',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set footer of embed [EMBED] text [TEXT] icon url [ICON_URL]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Footer text' },
              ICON_URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }
            }
          },
          {
            opcode: 'setEmbedAuthor',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set author of embed [EMBED] name [NAME] icon url [ICON_URL] url [URL]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Author name' },
              ICON_URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }
            }
          },
          {
            opcode: 'setEmbedImage',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set image of embed [EMBED] url [URL]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' }
            }
          },
          {
            opcode: 'setEmbedThumbnail',
            blockType: Scratch.BlockType.REPORTER,
            text: 'set thumbnail of embed [EMBED] url [URL]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' }
            }
          },
          {
            opcode: 'addEmbedField',
            blockType: Scratch.BlockType.REPORTER,
            text: 'add field to embed [EMBED] name [NAME] value [VALUE] inline [INLINE]',
            arguments: {
              EMBED: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Field name' },
              VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Field value' },
              INLINE: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: false }
            }
          },
          
          '---',

          // ========================
          //    Attachment Builder
          // ========================
          {
            opcode: 'createAttachmentList',
            blockType: Scratch.BlockType.REPORTER,
            text: 'create attachment list',
          },
          {
            opcode: 'addAttachment',
            blockType: Scratch.BlockType.REPORTER,
            text: 'upload attachment [FILE_DATA] named [FILENAME] for channel [CHANNEL_ID] to list [LIST]',
            arguments: {
              FILE_DATA: { type: Scratch.ArgumentType.STRING, defaultValue: 'data:text/plain;base64,SGVsbG8=' },
              FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'hello.txt' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' },
              LIST: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }
            }
          },
          
          '---',

          // ========================
          //    Advanced Messages
          // ========================
          {
            opcode: 'sendAdvancedMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'send message [MESSAGE] with embeds [EMBEDS] attachments [ATTACHMENTS] to channel [CHANNEL]',
            arguments: {
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: '' },
              EMBEDS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' },
              ATTACHMENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' },
              CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'sendAdvancedReply',
            blockType: Scratch.BlockType.COMMAND,
            text: 'send reply [REPLY] with embeds [EMBEDS] attachments [ATTACHMENTS] to message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              REPLY: { type: Scratch.ArgumentType.STRING, defaultValue: '' },
              EMBEDS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' },
              ATTACHMENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' },
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },

          '---',
          
          // ========================
          //     Message Queue
          // ========================
          {
            opcode: 'newMessage',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'new messages?',
          },
          {
            opcode: 'popMessage',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get next message',
          },
          {
            opcode: 'totalMessages',
            blockType: Scratch.BlockType.REPORTER,
            text: 'total messages',
          },
          
          '---',
          
          // ========================
          //       Cache
          // ========================
          {
            opcode: 'clearCache',
            blockType: Scratch.BlockType.COMMAND,
            text: 'clear message cache for channel [CHANNEL_ID]',
            arguments: {
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          {
            opcode: 'clearAllCache',
            blockType: Scratch.BlockType.COMMAND,
            text: 'clear all message cache',
          },
          {
            opcode: 'getCacheSize',
            blockType: Scratch.BlockType.REPORTER,
            text: 'cached messages in channel [CHANNEL_ID]',
            arguments: {
              CHANNEL_ID: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'channel_id'
              }
            }
          },
          
          '---',
          
          // ========================
          //       Commands
          // ========================
          {
            opcode: 'registerSlashCommand',
            blockType: Scratch.BlockType.COMMAND,
            text: 'register slash command [NAME] with description [DESCRIPTION] options [OPTIONS]',
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'command'
              },
              DESCRIPTION: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'description'
              },
              OPTIONS: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: '[]'
              }
            }
          },
          {
            opcode: 'deleteSlashCommand',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete slash command [NAME]',
            arguments: {
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'command'
              }
            }
          },
          {
            opcode: 'getAllCommands',
            blockType: Scratch.BlockType.REPORTER,
            text: 'all commands',
          },
          
          '---',
          
          // ========================
          //    Command Options
          // ========================
          {
            opcode: 'createCommandOptions',
            blockType: Scratch.BlockType.REPORTER,
            text: 'create options list',
          },
          {
            opcode: 'addCommandOption',
            blockType: Scratch.BlockType.REPORTER,
            text: 'add [TYPE] option name [NAME] description [DESCRIPTION] required [REQUIRED] to [OPTIONS]',
            arguments: {
              TYPE: {
                menu: 'OPTION_TYPE'
              },
              NAME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'option-name'
              },
              DESCRIPTION: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'option description'
              },
              REQUIRED: {
                type: Scratch.ArgumentType.BOOLEAN,
                defaultValue: false
              },
              OPTIONS: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: '[]'
              }
            }
          },
          
          '---',
          
          // ========================
          //     Interactions
          // ========================
          {
            opcode: 'newInteraction',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'new interactions?',
          },
          {
            opcode: 'popInteraction',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get next interaction',
          },
          {
            opcode: 'totalInteractions',
            blockType: Scratch.BlockType.REPORTER,
            text: 'total interactions',
          },
          {
            opcode: 'replyToInteraction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'reply to interaction [INTERACTION] with [CONTENT]',
            arguments: {
              INTERACTION: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: '{interaction object}'
              },
              CONTENT: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'content'
              }
            }
          },
          {
            opcode: 'replyToInteractionAdvanced',
            blockType: Scratch.BlockType.COMMAND,
            text: 'reply to interaction [INTERACTION] with content [CONTENT] embeds [EMBEDS] attachments [ATTACHMENTS]',
            arguments: {
              INTERACTION: { type: Scratch.ArgumentType.STRING, defaultValue: '{interaction object}' },
              CONTENT: { type: Scratch.ArgumentType.STRING, defaultValue: 'content' },
              EMBEDS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' },
              ATTACHMENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }
            }
          },
          
          '---',
          
          // ========================
          //       Status
          // ========================
          {
            opcode: 'setStatus',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set status to [STATUS]',
            arguments: {
              STATUS: {
                menu: 'STATUS'
              }
            }
          },
          {
            opcode: 'setActivity',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set activity to [TYPE] [ACTIVITY]',
            arguments: {
              TYPE: {
                menu: 'ACTIVITY_TYPE'
              },
              ACTIVITY: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: 'activity'
              }
            }
          },
        ],
        menus: {
          ACTIVITY_TYPE: {
            acceptReporters: true,
            items: [
              { text: "playing", value: 0 },
              { text: "streaming", value: 1 },
              { text: "listening", value: 2 },
              { text: "watching", value: 3 }
            ]
          },
          STATUS: [
            'online',
            'idle',
            'dnd',
            'invisible'
          ],
          OPTION_TYPE: {
            acceptReporters: false,
            items: [
              { text: "string", value: "string" },
              { text: "integer", value: "integer" },
              { text: "boolean", value: "boolean" },
              { text: "user", value: "user" },
              { text: "channel", value: "channel" }
            ]
          }
        }
      };
    }

    // ==============================================
    //            Connection Management
    // ==============================================
    
    setToken({ TOKEN }) {
      this.token = util.s(TOKEN);
    }

    connectToDiscord() {
      if (this.conn.isConnecting) return util.log('Already connecting...');
      if (!this.token) return util.err('Token not set');
      
      this.conn.isConnecting = true;
      this.conn.attempts++;
      this._connect();
    }

    disconnectFromDiscord() {
      if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
      
      clearInterval(this.conn.heartbeatTimer);
      clearTimeout(this.conn.reconnectTimer);
      this.conn.heartbeatTimer = null;
      this.conn.reconnectTimer = null;
      this.conn.isConnecting = false;
      
      this.client.close(1000, "User disconnect");
    }

    connected() {
      return (this.client && this.client.readyState === WebSocket.OPEN) || false;
    }

    botinfo() {
      return bot_data ? JSON.stringify(bot_data) : "{}";
    }

    getGuilds() {
      if (this.guildCache.size > 0) {
        const guilds = Array.from(this.guildCache.values());
        return Promise.resolve(JSON.stringify(guilds));
      }
      
      return new Promise(resolve => {
        this._apiRequest('/users/@me/guilds')
          .then(data => {
            if (Array.isArray(data)) {
              data.forEach(guild => this._cacheGuild(guild));
              resolve(JSON.stringify(data));
            } else {
              resolve('[]');
            }
          })
          .catch(err => {
            util.err('Get guilds error:', err);
            resolve('[]');
          });
      });
    }

    getGuildInfo({ GUILD_ID }) {
      const guildId = util.s(GUILD_ID);
      
      if (this.guildCache.has(guildId)) {
        return Promise.resolve(JSON.stringify(this.guildCache.get(guildId)));
      }
      
      return new Promise(resolve => {
        this._apiRequest(`/guilds/${guildId}`)
          .then(data => {
            this._cacheGuild(data);
            resolve(JSON.stringify(data));
          })
          .catch(err => {
            util.err('Get guild info error:', err);
            resolve('{"error": "Failed to get guild info"}');
          });
      });
    }

    _connect(resume = false) {
      this.client = new WebSocket(WS);
      
      this.client.onopen = () => {
        if (resume && this.conn.sessionId && this.conn.seq) {
          this.client.send(JSON.stringify({
            op: 6,
            d: {
              token: this.token,
              session_id: this.conn.sessionId,
              seq: this.conn.seq
            }
          }));
        } else {
          this.client.send(JSON.stringify({
            op: 2,
            d: {
              token: this.token,
              intents: 4194303,
              properties: {
                $os: "windows",
                $browser: "chrome",
                $device: "scratch"
              },
              presence: {
                status: this.status,
                activities: this.activity ? [{
                  name: this.activity[1],
                  type: +this.activity[0]
                }] : [],
                afk: false
              }
            }
          }));
        }
      };
      
      this.client.onmessage = msg => {
        try {
          const data = JSON.parse(msg.data);
          if (data.s) this.conn.seq = data.s;
          
          switch (data.op) {
            case 0:
              this._handleEvent(data);
              break;
            case 7:
              this._reconnect(true);
              break;
            case 9:
              setTimeout(() => this._reconnect(!data.d), 
                Math.floor(Math.random() * 4000) + 1000);
              break;
            case 10:
              clearInterval(this.conn.heartbeatTimer);
              this.conn.heartbeatTimer = setInterval(() => {
                if (this.client?.readyState === WebSocket.OPEN) {
                  this.client.send(JSON.stringify({op: 1, d: this.conn.seq}));
                }
              }, data.d.heartbeat_interval);
              this.client.send(JSON.stringify({op: 1, d: this.conn.seq}));
              break;
          }
        } catch (err) {
          util.err('WS msg error:', err);
        }
      };
      
      this.client.onclose = evt => {
        clearInterval(this.conn.heartbeatTimer);
        clearTimeout(this.conn.reconnectTimer);
        
        if ([1000, 4004, 4010, 4011, 4012, 4013, 4014].includes(evt.code)) {
          this.conn.isConnecting = false;
          return;
        }
        
        if (this.conn.attempts >= this.conn.maxAttempts) {
          this.conn.isConnecting = false;
          return util.err('Max reconnect attempts reached');
        }
        
        const delay = Math.min(Math.pow(2, this.conn.attempts) * 1000, 30000);
        this.conn.reconnectTimer = setTimeout(() => this._reconnect(true), delay);
      };
      
      this.client.onerror = err => util.err('WS error:', err);
    }

    _reconnect(tryResume) {
      if (this.client) {
        this.client.onclose = null;
        if (this.client.readyState !== WebSocket.CLOSED) {
          this.client.close();
        }
      }
      this._connect(tryResume);
    }

    _handleEvent(data) {
      switch (data.t) {
        case 'READY':
          this.conn.sessionId = data.d.session_id;
          bot_data = data.d;
          this.conn.isConnecting = false;
          this.conn.attempts = 0;
          break;
        case 'RESUMED':
          this.conn.isConnecting = false;
          this.conn.attempts = 0;
          break;
        case 'GUILD_CREATE':
          this._cacheGuild(data.d);
          break;
        case 'GUILD_UPDATE':
          this._cacheGuild(data.d);
          break;
        case 'GUILD_DELETE':
          this.guildCache.delete(data.d.id);
          break;
        case 'MESSAGE_CREATE':
          this.messages.push(JSON.stringify(data.d));
          util.limit(this.messages, 100);
          this._cacheMessage(data.d);
          break;
        case 'MESSAGE_UPDATE':
          this._updateCachedMessage(data.d);
          break;
        case 'MESSAGE_DELETE':
          this._deleteCachedMessage(data.d.channel_id, data.d.id);
          break;
        case 'INTERACTION_CREATE':
          this.interactions.push(JSON.stringify(data.d));
          util.limit(this.interactions, 100);
          break;
      }
    }

    _cacheMessage(message) {
      if (!message.channel_id || !message.id) return;
      
      if (!this.messageCache.has(message.channel_id)) {
        this.messageCache.set(message.channel_id, []);
      }
      
      const cache = this.messageCache.get(message.channel_id);
      
      const existingIndex = cache.findIndex(m => m.id === message.id);
      if (existingIndex !== -1) {
        cache[existingIndex] = message;
      } else {
        cache.unshift(message);
      }
      
      while (cache.length > this.maxCachePerChannel) {
        cache.pop();
      }
    }

    _updateCachedMessage(messageUpdate) {
      if (!messageUpdate.channel_id || !messageUpdate.id) return;
      
      const cache = this.messageCache.get(messageUpdate.channel_id);
      if (!cache) return;
      
      const index = cache.findIndex(m => m.id === messageUpdate.id);
      if (index !== -1) {
        cache[index] = { ...cache[index], ...messageUpdate };
      }
    }

    _deleteCachedMessage(channelId, messageId) {
      const cache = this.messageCache.get(channelId);
      if (!cache) return;
      
      const index = cache.findIndex(m => m.id === messageId);
      if (index !== -1) {
        cache.splice(index, 1);
      }
    }

    _cacheGuild(guild) {
      if (!guild.id) return;
      this.guildCache.set(guild.id, guild);
    }

    clearCache({ CHANNEL_ID }) {
      const channelId = util.s(CHANNEL_ID);
      this.messageCache.delete(channelId);
    }

    clearAllCache() {
      this.messageCache.clear();
      this.guildCache.clear();
    }

    getCacheSize({ CHANNEL_ID }) {
      const channelId = util.s(CHANNEL_ID);
      const cache = this.messageCache.get(channelId);
      return cache ? cache.length : 0;
    }

    // ==============================================
    //                API Requests
    // ==============================================
    
    async _apiRequest(endpoint, options = {}) {
      if (!this.token) return Promise.reject('No token');
      
      if (this.conn.rateLimited) {
        const now = Date.now();
        if (now < this.conn.rateLimitReset) {
          await new Promise(r => setTimeout(r, this.conn.rateLimitReset - now + 100));
          this.conn.rateLimited = false;
        }
      }

      const fetchOpts = {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bot ${this.token}`,
          'Content-Type': 'application/json'
        }
      };
      
      if (options.body) {
        fetchOpts.body = JSON.stringify(options.body);
      }
      
      try {
        const response = await fetch(`${API}${endpoint}`, fetchOpts);
        
        if (response.status === 429) {
          const data = await response.json();
          this.conn.rateLimited = true;
          this.conn.rateLimitReset = Date.now() + (data.retry_after * 1000);
          return this._apiRequest(endpoint, options);
        }
        
        if (response.ok) {
          if (options.method === 'DELETE' || response.headers.get('content-length') === '0') {
            return { success: true };
          }
          return await response.json().catch(() => ({ success: true }));
        }
        
        const error = await response.json().catch(() => ({ 
          status: response.status, 
          message: response.statusText 
        }));
        return Promise.reject(error);
      } catch (err) {
        util.err('API req failed:', err);
        return Promise.reject(err);
      }
    }

    _createMessagePayload(content, embedsStr, attachmentsStr, message_reference = null) {
      let payload = {};
      if (content) payload.content = util.s(content);
      if (message_reference) payload.message_reference = message_reference;

      if (embedsStr && embedsStr !== '[]' && embedsStr !== '{}') {
        try {
          const parsed = JSON.parse(util.s(embedsStr));
          payload.embeds = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          util.err('Error parsing embeds:', e);
        }
      }

      if (attachmentsStr && attachmentsStr !== '[]') {
        try {
          const parsed = JSON.parse(util.s(attachmentsStr));
          payload.attachments = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          util.err('Error parsing attachments:', e);
        }
      }

      return payload;
    }

    // ==============================================
    //              Message Methods
    // ==============================================
    
    sendMessage({ MESSAGE, CHANNEL }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL)}/messages`, {
        method: 'POST',
        body: { content: util.s(MESSAGE) }
      }).catch(err => util.err('Send msg error:', err));
    }

    sendAdvancedMessage({ MESSAGE, EMBEDS, ATTACHMENTS, CHANNEL }) {
      const channelId = util.s(CHANNEL);
      const payload = this._createMessagePayload(MESSAGE, EMBEDS, ATTACHMENTS);
      return this._apiRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: payload
      }).catch(err => util.err('Send advanced msg error:', err));
    }

    getMessage({ MESSAGE_ID, CHANNEL_ID }) {
      const messageId = util.s(MESSAGE_ID);
      const channelId = util.s(CHANNEL_ID);
      
      const cache = this.messageCache.get(channelId);
      if (cache) {
        const cachedMsg = cache.find(m => m.id === messageId);
        if (cachedMsg) {
          return Promise.resolve(JSON.stringify(cachedMsg));
        }
      }
      
      return new Promise(resolve => {
        this._apiRequest(`/channels/${channelId}/messages/${messageId}`)
          .then(data => {
            this._cacheMessage(data);
            resolve(JSON.stringify(data));
          })
          .catch(err => {
            util.err('Get msg error:', err);
            resolve('{"error": "Failed to get message"}');
          });
      });
    }

    getChannelMessages({ AMOUNT, CHANNEL_ID }) {
      let amount = Math.min(Math.max(parseInt(AMOUNT) || 1, 1), 100);
      const channelId = util.s(CHANNEL_ID);
      
      const cache = this.messageCache.get(channelId);
      if (cache && cache.length >= amount) {
        return Promise.resolve(JSON.stringify(cache.slice(0, amount)));
      }
      
      return new Promise(resolve => {
        this._apiRequest(`/channels/${channelId}/messages?limit=${amount}`)
          .then(data => {
            if (Array.isArray(data)) {
              data.forEach(msg => this._cacheMessage(msg));
              resolve(JSON.stringify(data));
            } else {
              resolve('[]');
            }
          })
          .catch(() => resolve('[]'));
      });
    }

    sendDirectMessage({ USER_ID, MESSAGE }) {
      return this._apiRequest('/users/@me/channels', {
        method: 'POST',
        body: { recipient_id: util.s(USER_ID) }
      })
      .then(data => {
        if (!data.id) return Promise.reject('Failed to create DM');
        return this._apiRequest(`/channels/${data.id}/messages`, {
          method: 'POST',
          body: { content: util.s(MESSAGE) }
        });
      })
      .catch(err => util.err('DM error:', err));
    }

    deleteMessage({ MESSAGE_ID, CHANNEL_ID }) {
      const channelId = util.s(CHANNEL_ID);
      const messageId = util.s(MESSAGE_ID);
      
      return this._apiRequest(
        `/channels/${channelId}/messages/${messageId}`, 
        { method: 'DELETE' }
      )
      .then(result => {
        this._deleteCachedMessage(channelId, messageId);
        return result;
      })
      .catch(err => util.err('Delete error:', err));
    }

    sendReply({ REPLY, MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages`, {
        method: 'POST',
        body: {
          content: util.s(REPLY),
          message_reference: {
            message_id: util.s(MESSAGE_ID),
            channel_id: util.s(CHANNEL_ID)
          }
        }
      }).catch(err => util.err('Reply error:', err));
    }

    sendAdvancedReply({ REPLY, EMBEDS, ATTACHMENTS, MESSAGE_ID, CHANNEL_ID }) {
      const channelId = util.s(CHANNEL_ID);
      const reference = {
        message_id: util.s(MESSAGE_ID),
        channel_id: channelId
      };
      const payload = this._createMessagePayload(REPLY, EMBEDS, ATTACHMENTS, reference);
      return this._apiRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: payload
      }).catch(err => util.err('Advanced reply error:', err));
    }

    addReaction({ EMOJI, MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(
        `/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}/reactions/${encodeURIComponent(util.s(EMOJI))}/@me`,
        { method: 'PUT' }
      ).catch(err => util.err('Reaction error:', err));
    }

    removeReaction({ EMOJI, MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(
        `/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}/reactions/${encodeURIComponent(util.s(EMOJI))}/@me`,
        { method: 'DELETE' }
      ).catch(err => util.err('Remove reaction error:', err));
    }

    // ==============================================
    //               Embed Builder
    // ==============================================
    
    createEmbed() {
      return '{}';
    }

    createEmbedList() {
      return '[]';
    }

    addEmbedToList({ EMBED, LIST }) {
      try {
        const list = JSON.parse(util.s(LIST) || '[]');
        const embed = JSON.parse(util.s(EMBED) || '{}');
        if (Array.isArray(list)) {
          list.push(embed);
          return JSON.stringify(list);
        }
      } catch (e) {
        util.err('Add embed to list error:', e);
      }
      return util.s(LIST) || '[]';
    }

    setEmbedTitle({ EMBED, TITLE, URL }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        embed.title = util.s(TITLE);
        if (URL) embed.url = util.s(URL);
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    setEmbedDescription({ EMBED, DESCRIPTION }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        embed.description = util.s(DESCRIPTION);
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    setEmbedColor({ EMBED, COLOR }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        let colorStr = util.s(COLOR).trim();
        if (colorStr.startsWith('#')) {
          embed.color = parseInt(colorStr.replace('#', ''), 16);
        } else {
          const parsed = parseInt(colorStr);
          embed.color = isNaN(parsed) ? 0 : parsed;
        }
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    setEmbedFooter({ EMBED, TEXT, ICON_URL }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        embed.footer = { text: util.s(TEXT) };
        if (ICON_URL) embed.footer.icon_url = util.s(ICON_URL);
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    setEmbedAuthor({ EMBED, NAME, ICON_URL, URL }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        embed.author = { name: util.s(NAME) };
        if (ICON_URL) embed.author.icon_url = util.s(ICON_URL);
        if (URL) embed.author.url = util.s(URL);
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    setEmbedImage({ EMBED, URL }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        embed.image = { url: util.s(URL) };
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    setEmbedThumbnail({ EMBED, URL }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        embed.thumbnail = { url: util.s(URL) };
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    addEmbedField({ EMBED, NAME, VALUE, INLINE }) {
      try {
        const embed = JSON.parse(util.s(EMBED) || '{}');
        if (!embed.fields) embed.fields = [];
        embed.fields.push({
          name: util.s(NAME),
          value: util.s(VALUE),
          inline: Boolean(INLINE)
        });
        return JSON.stringify(embed);
      } catch (e) {
        return util.s(EMBED) || '{}';
      }
    }

    // ==============================================
    //             Attachment Builder
    // ==============================================

    createAttachmentList() {
      return '[]';
    }

    async addAttachment({ FILE_DATA, FILENAME, CHANNEL_ID, LIST }) {
      try {
        const list = JSON.parse(util.s(LIST) || '[]');
        if (!Array.isArray(list)) return util.s(LIST) || '[]';

        const fileData = util.s(FILE_DATA);
        const filename = util.s(FILENAME);
        const channelId = util.s(CHANNEL_ID);

        // 1. Fetch asset local buffer to compute accurate file sizing
        const localRes = await fetch(fileData);
        const blob = await localRes.blob();
        const fileSize = blob.size;

        // 2. Request an upload payload slot via Discord Attachment REST API
        const registerRes = await this._apiRequest(`/channels/${channelId}/attachments`, {
          method: 'POST',
          body: {
            files: [
              {
                id: list.length,
                filename: filename,
                file_size: fileSize
              }
            ]
          }
        });

        if (!registerRes || !registerRes.attachments || registerRes.attachments.length === 0) {
          util.err('Failed to allocate attachment entry via Discord REST API');
          return JSON.stringify(list);
        }

        const targetInfo = registerRes.attachments[0];
        const targetUploadUrl = targetInfo.upload_url;
        // NOTE: Discord's /channels/{id}/attachments response only gives back
        // `id`, `upload_url`, and `upload_filename` (no "ed"). It does NOT echo
        // back `filename`. The message-send payload, however, expects the key
        // `uploaded_filename` (with "ed"). So we keep our own `filename` and
        // re-key `upload_filename` -> `uploaded_filename` below.

        // 3. Directly PUT file payload straight to assigned destination endpoint
        //    (or relay it through UPLOAD_PROXY if CORS blocks the direct PUT —
        //    see the comment near the top of this file)
        const uploadEndpoint = UPLOAD_PROXY
          ? `${UPLOAD_PROXY}${encodeURIComponent(targetUploadUrl)}`
          : targetUploadUrl;

        const rawUploadRes = await fetch(uploadEndpoint, {
          method: 'PUT',
          headers: {
            'Content-Type': blob.type || 'application/octet-stream'
          },
          body: blob
        });

        if (!rawUploadRes.ok) {
          util.err('File transmission to storage platform rejected');
          return JSON.stringify(list);
        }

        // 4. Inject tracked server-side registered target descriptors into array reference mapping
        list.push({
          id: targetInfo.id,
          filename: filename,
          uploaded_filename: targetInfo.upload_filename
        });

        return JSON.stringify(list);
      } catch (e) {
        util.err('Error during live asset generation process:', e);
        return util.s(LIST) || '[]';
      }
    }

    // ==============================================
    //               Message Queue
    // ==============================================
    
    newMessage() { 
      return this.messages.length > 0; 
    }
    
    popMessage() { 
      return this.messages.shift() || ""; 
    }
    
    totalMessages() { 
      return this.messages.length; 
    }

    // ==============================================
    //                 Commands
    // ==============================================
    
    registerSlashCommand({ NAME, DESCRIPTION, OPTIONS }) {
      if (!bot_data?.application?.id) return util.err('Not connected');
      
      let options = [];
      try {
        if (OPTIONS && OPTIONS !== '[]') options = JSON.parse(util.s(OPTIONS));
      } catch (err) {
        util.err('Bad options:', err);
        options = [];
      }
      
      return this._apiRequest(`/applications/${bot_data.application.id}/commands`, {
        method: 'POST',
        body: {
          name: util.s(NAME),
          description: util.s(DESCRIPTION),
          options: options,
          contexts: [0, 1, 2],
          integration_types: [0, 1]
        }
      })
      .then(data => {
        if (!data.id) util.err('Command reg failed:', data);
      })
      .catch(err => util.err('Command reg error:', err));
    }

    deleteSlashCommand({ NAME }) {
      if (!bot_data?.application?.id) return util.err('Not connected');
      NAME = util.s(NAME);
      
      return this._apiRequest(`/applications/${bot_data.application.id}/commands`)
        .then(data => {
          if (!Array.isArray(data)) return Promise.reject('Failed to get cmds');
          
          const cmd = data.find(c => c.name === NAME);
          if (!cmd) return util.err(`Command "${NAME}" not found`);
          
          return this._apiRequest(`/applications/${bot_data.application.id}/commands/${cmd.id}`, {
            method: 'DELETE'
          });
        })
        .catch(err => util.err('Delete cmd error:', err));
    }

    getAllCommands() {
      if (!bot_data?.application?.id) return '[]';
      
      return new Promise(resolve => {
        this._apiRequest(`/applications/${bot_data.application.id}/commands`)
          .then(data => {
            if (Array.isArray(data)) {
              resolve(JSON.stringify(data.map(cmd => `/${cmd.name}`)));
            } else resolve('[]');
          })
          .catch(() => resolve('[]'));
      });
    }

    // ==============================================
    //              Command Options
    // ==============================================
    
    createCommandOptions() { 
      return '[]'; 
    }

    addCommandOption({ TYPE, NAME, DESCRIPTION, REQUIRED, OPTIONS }) {
      const typeMap = {
        'string': 3,
        'integer': 4,
        'boolean': 5,
        'user': 6,
        'channel': 7
      };
      
      return this._addOptionToList({
        type: typeMap[TYPE] || 3,
        name: util.s(NAME),
        description: util.s(DESCRIPTION),
        required: Boolean(REQUIRED)
      }, OPTIONS);
    }

    _addOptionToList(option, optionsList) {
      try {
        let options = [];
        if (optionsList && optionsList !== '[]') {
          options = JSON.parse(util.s(optionsList));
        }
        if (!Array.isArray(options)) options = [];
        
        option.name = option.name.toLowerCase().replace(/\s+/g, '-');
        options.push(option);
        return JSON.stringify(options);
      } catch (err) {
        util.err('Option add error:', err);
        return '[]';
      }
    }

    // ==============================================
    //              Interactions
    // ==============================================
    
    newInteraction() { 
      return this.interactions.length > 0; 
    }
    
    popInteraction() { 
      return this.interactions.shift() || ""; 
    }
    
    totalInteractions() { 
      return this.interactions.length; 
    }

    replyToInteraction({ INTERACTION, CONTENT }) {
      try {
        const interaction = JSON.parse(util.s(INTERACTION));
        return this._apiRequest(`/interactions/${interaction.id}/${interaction.token}/callback`, {
          method: 'POST',
          body: {
            type: 4,
            data: { content: util.s(CONTENT) }
          }
        }).catch(err => util.err('Interaction reply error:', err));
      } catch (err) {
        util.err('Interaction parse error:', err);
      }
    }

    replyToInteractionAdvanced({ INTERACTION, CONTENT, EMBEDS, ATTACHMENTS }) {
      try {
        const interaction = JSON.parse(util.s(INTERACTION));
        let dataPayload = { content: util.s(CONTENT) };

        if (EMBEDS && EMBEDS !== '[]' && EMBEDS !== '{}') {
          try {
            const parsed = JSON.parse(util.s(EMBEDS));
            dataPayload.embeds = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            util.err('Error parsing interaction embeds:', e);
          }
        }

        if (ATTACHMENTS && ATTACHMENTS !== '[]') {
          try {
            const parsed = JSON.parse(util.s(ATTACHMENTS));
            dataPayload.attachments = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            util.err('Error parsing interaction attachments:', e);
          }
        }

        return this._apiRequest(`/interactions/${interaction.id}/${interaction.token}/callback`, {
          method: 'POST',
          body: {
            type: 4,
            data: dataPayload
          }
        }).catch(err => util.err('Interaction reply error:', err));
      } catch (err) {
        util.err('Interaction parse error:', err);
      }
    }

    // ==============================================
    //                Status
    // ==============================================
    
    setStatus({ STATUS }) {
      this.status = util.s(STATUS);
      this._updatePresence();
    }

    setActivity({ TYPE, ACTIVITY }) {
      this.activity = [util.s(TYPE), util.s(ACTIVITY)];
      this._updatePresence();
    }

    _updatePresence() {
      if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
      
      this.client.send(JSON.stringify({
        op: 3,
        d: {
          since: null,
          activities: this.activity ? [{
            name: this.activity[1],
            type: +this.activity[0]
          }] : [],
          status: this.status || "online",
          afk: false
        }
      }));
    }
  }

  Scratch.extensions.register(new DiscordBot());
})(Scratch);