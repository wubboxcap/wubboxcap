// ImgBB API wrapper extension for TurboWarp
//
// HOW TO LOAD:
//   1. In TurboWarp, click the "Add Extension" button (puzzle piece, bottom-left).
//   2. Scroll down and click "Custom Extension".
//   3. Choose "Text" and paste this whole file (or host it somewhere and paste the URL).
//   4. Make sure "unsandboxed" is selected/confirmed when prompted — this extension
//      needs network access and DOM access (for the file picker), so it cannot run sandboxed.
//
// HOW TO USE (basic example):
//   set ImgBB API key to [your key from https://api.imgbb.com/]
//   upload image from URL [https://example.com/cat.png] named [cat] expire in [0] sec
//   when image upload finishes
//     if <last upload succeeded?> then
//       say (image [url])
//     else
//       say (join [Upload failed: ] (last error message))

(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('The ImgBB extension must be run unsandboxed');
  }

  const EXT_ID = 'imgbbWrapper';

  class ImgBBExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this.apiKey = '';
      this.uploading = false;
      this.lastSuccess = false;
      this.lastError = '';
      this.lastResult = null; // the "data" object from imgbb's response
      this.lastRaw = '';      // raw response JSON as text
      this.pickedFileData = ''; // data URI of a locally chosen file
    }

    getInfo() {
      return {
        id: EXT_ID,
        name: 'ImgBB',
        color1: '#ED5C5C',
        color2: '#D44C4C',
        blocks: [
          {
            opcode: 'setApiKey',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set ImgBB API key to [KEY]',
            arguments: {
              KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'your-api-key-here' }
            }
          },
          '---',
          {
            opcode: 'uploadUrl',
            blockType: Scratch.BlockType.COMMAND,
            text: 'upload image from URL [URL] named [NAME] expire in [EXPIRE] sec (0 = never)',
            arguments: {
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://example.com/cat.png' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'image' },
              EXPIRE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            opcode: 'uploadBase64',
            blockType: Scratch.BlockType.COMMAND,
            text: 'upload image data [DATA] named [NAME] expire in [EXPIRE] sec (0 = never)',
            arguments: {
              DATA: { type: Scratch.ArgumentType.STRING, defaultValue: '' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'image' },
              EXPIRE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            opcode: 'uploadCostume',
            blockType: Scratch.BlockType.COMMAND,
            text: 'upload current costume of [SPRITE]',
            arguments: {
              SPRITE: { type: Scratch.ArgumentType.STRING, defaultValue: 'this sprite', menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'uploadStage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'upload screenshot of the stage'
          },
          '---',
          {
            opcode: 'pickFile',
            blockType: Scratch.BlockType.COMMAND,
            text: 'choose an image file from this device'
          },
          {
            opcode: 'pickedFile',
            blockType: Scratch.BlockType.REPORTER,
            text: 'chosen file data'
          },
          {
            opcode: 'uploadPickedFile',
            blockType: Scratch.BlockType.COMMAND,
            text: 'upload chosen file named [NAME] expire in [EXPIRE] sec (0 = never)',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'image' },
              EXPIRE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          '---',
          {
            opcode: 'whenUploadDone',
            blockType: Scratch.BlockType.EVENT,
            text: 'when image upload finishes',
            isEdgeActivated: false
          },
          {
            opcode: 'isUploading',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'uploading?'
          },
          {
            opcode: 'uploadSucceeded',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'last upload succeeded?'
          },
          '---',
          {
            opcode: 'getProperty',
            blockType: Scratch.BlockType.REPORTER,
            text: 'image [PROPERTY]',
            arguments: {
              PROPERTY: { type: Scratch.ArgumentType.STRING, menu: 'propertyMenu' }
            }
          },
          {
            opcode: 'getRawJson',
            blockType: Scratch.BlockType.REPORTER,
            text: 'raw response JSON'
          },
          {
            opcode: 'getError',
            blockType: Scratch.BlockType.REPORTER,
            text: 'last error message'
          },
          '---',
          {
            opcode: 'openDeletePage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'open delete page for last uploaded image'
          }
        ],
        menus: {
          propertyMenu: {
            acceptReporters: true,
            items: [
              'url', 'display_url', 'viewer_url', 'thumb_url', 'medium_url',
              'delete_url', 'width', 'height', 'size', 'filename', 'id', 'title'
            ]
          },
          spriteMenu: {
            acceptReporters: true,
            items: 'getSpriteMenu'
          }
        }
      };
    }

    getSpriteMenu() {
      const names = ['this sprite'];
      if (this.runtime && this.runtime.targets) {
        for (const t of this.runtime.targets) {
          if (t.isOriginal && !t.isStage) names.push(t.getName());
        }
      }
      return names;
    }

    // ---- simple getters/setters ----

    setApiKey(args) {
      this.apiKey = Scratch.Cast.toString(args.KEY).trim();
    }

    isUploading() {
      return this.uploading;
    }

    uploadSucceeded() {
      return this.lastSuccess;
    }

    getError() {
      return this.lastError;
    }

    getRawJson() {
      return this.lastRaw;
    }

    pickedFile() {
      return this.pickedFileData;
    }

    openDeletePage() {
      if (this.lastResult && this.lastResult.delete_url) {
        window.open(this.lastResult.delete_url, '_blank');
      }
    }

    getProperty(args) {
      if (!this.lastResult) return '';
      const d = this.lastResult;
      switch (args.PROPERTY) {
        case 'url': return d.url || '';
        case 'display_url': return d.display_url || '';
        case 'viewer_url': return d.url_viewer || '';
        case 'thumb_url': return (d.thumb && d.thumb.url) || '';
        case 'medium_url': return (d.medium && d.medium.url) || '';
        case 'delete_url': return d.delete_url || '';
        case 'width': return d.width || '';
        case 'height': return d.height || '';
        case 'size': return d.size || '';
        case 'filename': return (d.image && d.image.filename) || '';
        case 'id': return d.id || '';
        case 'title': return d.title || '';
        default: return '';
      }
    }

    // ---- local file picking ----

    pickFile() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (!file) {
            finish();
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            this.pickedFileData = reader.result;
            finish();
          };
          reader.onerror = () => finish();
          reader.readAsDataURL(file);
        });
        // If the user cancels the dialog, no "change" event fires.
        // Falling back to the window regaining focus to avoid hanging forever.
        const onFocus = () => {
          window.removeEventListener('focus', onFocus);
          setTimeout(finish, 300);
        };
        window.addEventListener('focus', onFocus);
        input.click();
      });
    }

    // ---- upload entry points ----

    uploadUrl(args) {
      return this._upload(Scratch.Cast.toString(args.URL), args.NAME, args.EXPIRE);
    }

    uploadBase64(args) {
      const data = Scratch.Cast.toString(args.DATA).replace(/^data:image\/\w+;base64,/, '');
      return this._upload(data, args.NAME, args.EXPIRE);
    }

    uploadPickedFile(args) {
      if (!this.pickedFileData) {
        this.lastError = 'No file has been chosen yet';
        this.lastSuccess = false;
        return;
      }
      const data = this.pickedFileData.replace(/^data:image\/\w+;base64,/, '');
      return this._upload(data, args.NAME, args.EXPIRE);
    }

    uploadStage() {
      try {
        const canvas = this.runtime.renderer.canvas;
        const dataUri = canvas.toDataURL('image/png');
        const data = dataUri.replace(/^data:image\/\w+;base64,/, '');
        return this._upload(data, 'stage', 0);
      } catch (e) {
        this.lastError = 'Could not capture the stage: ' + e.message;
        this.lastSuccess = false;
      }
    }

    uploadCostume(args, util) {
      try {
        let target;
        if (args.SPRITE === 'this sprite') {
          target = util.target;
        } else {
          target = this.runtime.getSpriteTargetByName(args.SPRITE);
        }
        if (!target) {
          this.lastError = 'Could not find that sprite';
          this.lastSuccess = false;
          return;
        }
        const costume = target.getCurrentCostume();
        const dataUri = costume.asset.encodeDataURI();
        const data = dataUri.replace(/^data:image\/\w+;base64,/, '');
        return this._upload(data, costume.name || 'costume', 0);
      } catch (e) {
        this.lastError = 'Could not read that costume: ' + e.message;
        this.lastSuccess = false;
      }
    }

    // ---- the actual API call ----

    async _upload(imageValue, name, expiration) {
      if (!this.apiKey) {
        this.lastError = 'No API key set. Use "set ImgBB API key" first.';
        this.lastSuccess = false;
        this._fireDone();
        return;
      }
      this.uploading = true;
      this.lastError = '';
      try {
        const form = new FormData();
        form.append('key', this.apiKey);
        form.append('image', imageValue);
        if (name) form.append('name', Scratch.Cast.toString(name));
        const exp = Scratch.Cast.toNumber(expiration);
        if (exp && exp > 0) form.append('expiration', String(Math.round(exp)));

        const response = await fetch('https://api.imgbb.com/1/upload', {
          method: 'POST',
          body: form
        });
        const text = await response.text();
        this.lastRaw = text;

        let json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error('Server did not return valid JSON');
        }

        if (!response.ok || !json.success) {
          const msg = (json.error && json.error.message) || ('HTTP ' + response.status);
          throw new Error(msg);
        }

        this.lastResult = json.data;
        this.lastSuccess = true;
      } catch (e) {
        this.lastSuccess = false;
        this.lastError = e.message || String(e);
        this.lastResult = null;
      } finally {
        this.uploading = false;
        this._fireDone();
      }
    }

    _fireDone() {
      this.runtime.startHats(EXT_ID + '_whenUploadDone');
    }
  }

  Scratch.extensions.register(new ImgBBExtension(Scratch.vm.runtime));
})(Scratch);
