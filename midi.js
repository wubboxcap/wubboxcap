// ===========================================================================
//  MIDI Extension for TurboWarp / PenguinMod
//  Inspired by Python's `mido` module
//  Icon: https://upload.wikimedia.org/wikipedia/commons/e/ec/Twemoji_1f3b9.svg
// ===========================================================================

(function (Scratch) {
  "use strict";

  // ─── Utilities ─────────────────────────────────────────────────────────────

  /** Parse a raw MIDI binary (Uint8Array) into a structured object. */
  function parseMidi(bytes) {
    let pos = 0;

    function readUint32() {
      const v =
        (bytes[pos] << 24) | (bytes[pos + 1] << 16) |
        (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 4;
      return v >>> 0;
    }
    function readUint16() {
      const v = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
      return v;
    }
    function readUint8() { return bytes[pos++]; }
    function readVarLen() {
      let value = 0, byte;
      do { byte = readUint8(); value = (value << 7) | (byte & 0x7f); }
      while (byte & 0x80);
      return value;
    }
    function readBytes(n) { const c = bytes.slice(pos, pos + n); pos += n; return c; }

    const headerTag = String.fromCharCode(...bytes.slice(0, 4));
    pos = 4;
    if (headerTag !== "MThd") throw new Error("Not a MIDI file (missing MThd)");

    const headerLen  = readUint32(); // eslint-disable-line no-unused-vars
    const format     = readUint16();
    const numTracks  = readUint16();
    const timeDivision = readUint16();
    const tracks = [];

    for (let t = 0; t < numTracks; t++) {
      const trackTag = String.fromCharCode(...bytes.slice(pos, pos + 4));
      pos += 4;
      if (trackTag !== "MTrk") throw new Error(`Track ${t}: missing MTrk tag`);
      const trackLen = readUint32();
      const trackEnd = pos + trackLen;
      const messages = [];
      let lastStatus = 0;

      while (pos < trackEnd) {
        const delta = readVarLen();
        let statusByte = bytes[pos];
        if (statusByte < 0x80) { statusByte = lastStatus; }
        else { pos++; lastStatus = statusByte; }

        const type    = statusByte & 0xf0;
        const channel = statusByte & 0x0f;
        let msg = { delta };

        if (statusByte === 0xff) {
          const metaType = readUint8();
          const metaLen  = readVarLen();
          const metaData = readBytes(metaLen);
          msg.type = "meta"; msg.metaType = metaType; msg.data = metaData;
          switch (metaType) {
            case 0x51: {
              const tempo = (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
              msg.metaName = "set_tempo"; msg.tempo = tempo;
              msg.bpm = Math.round(60000000 / tempo); break;
            }
            case 0x58:
              msg.metaName = "time_signature";
              msg.numerator = metaData[0]; msg.denominator = Math.pow(2, metaData[1]);
              msg.clocksPerClick = metaData[2]; msg.notesPerQuarter = metaData[3]; break;
            case 0x59:
              msg.metaName = "key_signature";
              msg.key = metaData[0]; msg.scale = metaData[1] === 0 ? "major" : "minor"; break;
            case 0x2f: msg.metaName = "end_of_track"; break;
            case 0x03: msg.metaName = "track_name"; msg.text = String.fromCharCode(...metaData); break;
            case 0x01: msg.metaName = "text"; msg.text = String.fromCharCode(...metaData); break;
            default:   msg.metaName = `meta_0x${metaType.toString(16).padStart(2, "0")}`;
          }
        } else if (statusByte === 0xf0 || statusByte === 0xf7) {
          const sysexLen  = readVarLen();
          const sysexData = readBytes(sysexLen);
          msg.type = "sysex"; msg.data = sysexData;
        } else {
          msg.channel = channel;
          switch (type) {
            case 0x80: msg.type = "note_off"; msg.note = readUint8(); msg.velocity = readUint8(); break;
            case 0x90: {
              const note = readUint8(), velocity = readUint8();
              msg.type = velocity === 0 ? "note_off" : "note_on";
              msg.note = note; msg.velocity = velocity; break;
            }
            case 0xa0: msg.type = "aftertouch";       msg.note    = readUint8(); msg.value   = readUint8(); break;
            case 0xb0: msg.type = "control_change";   msg.control = readUint8(); msg.value   = readUint8(); break;
            case 0xc0: msg.type = "program_change";   msg.program = readUint8(); break;
            case 0xd0: msg.type = "channel_pressure"; msg.value   = readUint8(); break;
            case 0xe0: {
              const lsb = readUint8(), msb = readUint8();
              msg.type = "pitchwheel"; msg.pitch = ((msb << 7) | lsb) - 8192; break;
            }
            default: msg.type = "unknown"; break;
          }
        }
        messages.push(msg);
      }
      pos = trackEnd;
      tracks.push(messages);
    }
    return { format, numTracks, timeDivision, tracks };
  }

  function base64ToBytes(str) {
    const b64 = str.includes(",") ? str.split(",")[1] : str;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function fetchBytes(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    return new Uint8Array(await resp.arrayBuffer());
  }

  function computeAbsoluteTimes(midiObj) {
    return midiObj.tracks.map((track) => {
      let tick = 0;
      return track.map((msg) => { tick += msg.delta; return { ...msg, absoluteTick: tick }; });
    });
  }

  function mergeToFlat(midiObj) {
    const abs = computeAbsoluteTimes(midiObj);
    return abs.flat().sort((a, b) => a.absoluteTick - b.absoluteTick);
  }

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function noteToName(note) {
    return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
  }

  // ─── Instrument Guesser ────────────────────────────────────────────────────
  //
  //  Scratch instruments (1-indexed):
  //  1  Piano            2  Electric Piano   3  Organ
  //  4  Guitar           5  Electric Guitar  6  Bass
  //  7  Pizzicato        8  Cello            9  Trombone
  // 10  Clarinet        11  Saxophone       12  Flute
  // 13  Wooden Flute    14  Bassoon         15  Choir
  // 16  Vibraphone      17  Music Box       18  Steel Drum
  // 19  Marimba         20  Synth Lead      21  Synth Pad

  // GM program numbers → Scratch instrument index
  // (0-indexed GM program → 1-indexed Scratch instrument)
  const GM_TO_SCRATCH = {
    // Piano family (0-7) → Piano (1) or Electric Piano (2)
    0: 1, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1,
    // Chromatic Perc (8-15) → Vibraphone(16), Music Box(17), Marimba(19), Steel Drum(18)
    8: 17, 9: 16, 10: 19, 11: 18, 12: 16, 13: 19, 14: 18, 15: 17,
    // Organ (16-23) → Organ (3)
    16: 3, 17: 3, 18: 3, 19: 3, 20: 3, 21: 3, 22: 3, 23: 3,
    // Guitar (24-31) → Guitar (4) / Electric Guitar (5)
    24: 4, 25: 4, 26: 4, 27: 4, 28: 5, 29: 5, 30: 5, 31: 5,
    // Bass (32-39) → Bass (6)
    32: 6, 33: 6, 34: 6, 35: 6, 36: 6, 37: 6, 38: 6, 39: 6,
    // Strings (40-47) → Cello (8) / Pizzicato (7)
    40: 8, 41: 8, 42: 8, 43: 8, 44: 8, 45: 7, 46: 7, 47: 7,
    // Ensemble (48-55) → Choir (15) / Cello (8)
    48: 8, 49: 8, 50: 8, 51: 8, 52: 15, 53: 15, 54: 15, 55: 15,
    // Brass (56-63) → Trombone (9)
    56: 9, 57: 9, 58: 9, 59: 9, 60: 9, 61: 9, 62: 9, 63: 9,
    // Reed (64-71) → Saxophone (11) / Clarinet (10) / Bassoon (14)
    64: 11, 65: 11, 66: 11, 67: 11, 68: 10, 69: 10, 70: 14, 71: 14,
    // Pipe (72-79) → Flute (12) / Wooden Flute (13)
    72: 12, 73: 13, 74: 12, 75: 13, 76: 12, 77: 13, 78: 12, 79: 13,
    // Synth Lead (80-87) → Synth Lead (20)
    80: 20, 81: 20, 82: 20, 83: 20, 84: 20, 85: 20, 86: 20, 87: 20,
    // Synth Pad (88-95) → Synth Pad (21)
    88: 21, 89: 21, 90: 21, 91: 21, 92: 21, 93: 21, 94: 21, 95: 21,
    // Synth Effects (96-103) → Synth Lead (20)
    96: 20, 97: 20, 98: 20, 99: 20, 100: 20, 101: 20, 102: 20, 103: 20,
    // Ethnic (104-111) → various
    104: 4, 105: 7, 106: 4, 107: 19, 108: 17, 109: 13, 110: 12, 111: 3,
    // Percussive (112-119) → Music Box (17) / Marimba (19) / Steel Drum (18)
    112: 17, 113: 19, 114: 18, 115: 17, 116: 18, 117: 19, 118: 19, 119: 18,
    // Sound Effects (120-127) → Piano (1) as fallback
    120: 1, 121: 1, 122: 1, 123: 1, 124: 1, 125: 1, 126: 1, 127: 1,
  };

  // Track name keywords → Scratch instrument index.
  //
  // ORDERING RULE: more-specific patterns MUST appear BEFORE any pattern
  // whose keyword is a substring of the specific one, because the loop
  // stops at the FIRST match.  Key orderings:
  //   "electronic/electric piano" contains "piano"   → must come first
  //   "electric guitar"           contains "guitar"  → must come first
  //   "wooden flute"              contains "flute"   → must come first
  //   "steel drum"                contains "drum"    → must come first
  //   "synth lead/pad"            contains "lead/pad"→ must come first
  const NAME_KEYWORDS = [
    // Electric / Electronic piano  (BEFORE plain "piano") ----------------
    { re: /electr(?:ic|onic)\s*piano|e\.?\s*piano|epiano|elec\.?\s*pno/i, inst: 2 },
    // Plain piano / keyboard
    { re: /piano|keyboard|keys|pno/i,              inst: 1  },
    // Organ
    { re: /organ|hammond|org/i,                    inst: 3  },
    // Electric guitar  (BEFORE plain "guitar")
    { re: /electr(?:ic|onic)\s*guitar|lead\s*guitar|e\.?\s*gtr/i, inst: 5 },
    // Acoustic / plain guitar
    { re: /acoustic\s*guitar|folk\s*guitar|guitar|gtr/i, inst: 4 },
    // Bass
    { re: /bass/i,                                 inst: 6  },
    // Pizzicato
    { re: /pizzicato|pizz/i,                       inst: 7  },
    // Strings / cello
    { re: /cello|strings|string\s*ens|violin|viola/i, inst: 8 },
    // Brass / trombone
    { re: /trombone|trumpet|brass|horn|tbn|trb/i,  inst: 9  },
    // Clarinet
    { re: /clarinet|clar|cl\b/i,                  inst: 10 },
    // Saxophone
    { re: /saxophone|sax|alto|tenor|soprano\s*sax/i, inst: 11 },
    // Wooden flute / recorder  (BEFORE plain "flute")
    { re: /wood(?:en)?\s*flute|recorder|shakuhachi|panpipe/i, inst: 13 },
    // Plain flute
    { re: /flute/i,                                inst: 12 },
    // Bassoon / oboe
    { re: /bassoon|contrabass|oboe|fagott/i,       inst: 14 },
    // Choir / vocals
    { re: /choir|vocal|voice|ooh|aah|chorus/i,     inst: 15 },
    // Vibraphone
    { re: /vibraphone|vibes|vib\b/i,              inst: 16 },
    // Music box / celesta
    { re: /music\s*box|celesta|musicbox/i,        inst: 17 },
    // Steel drum  (BEFORE any generic "drum")
    { re: /steel\s*drum|steelpan|pan\s*drum/i,   inst: 18 },
    // Marimba / xylophone
    { re: /marimba|xylophone|xylo/i,               inst: 19 },
    // Synth Lead  (BEFORE plain "lead")
    { re: /synth\s*lead|lead\s*synth|moog/i,     inst: 20 },
    // Synth Pad  (BEFORE plain "pad")
    { re: /synth\s*pad|pad\s*synth/i,            inst: 21 },
  ];

  function guessInstrumentFromTrack(track) {
    // 1) First, check track_name meta messages against keyword table
    for (const msg of track) {
      if (msg.metaName === "track_name" && msg.text) {
        for (const { re, inst } of NAME_KEYWORDS) {
          if (re.test(msg.text)) return inst;
        }
      }
    }

    // 2) Fall back to the first program_change on any channel
    for (const msg of track) {
      if (msg.type === "program_change" && msg.program !== undefined) {
        return GM_TO_SCRATCH[msg.program] ?? 1;
      }
    }

    // 3) Default: Piano
    return 1;
  }

  // ─── SharkPool-style fill-in helpers ──────────────────────────────────────
  //
  //  These mirror the pattern from Swift JSON (SPjson) by SharkPool.
  //  genRegenReporter() creates a hidden block that reads its value off the
  //  outermost stack frame, which the C-block loop writes to each iteration.
  //  genXML() wraps a block definition with a pre-built XML shadow that drops
  //  those regen reporters into the matching argument slots automatically.

  const EXT_ID = "midiExtension";

  /** Create a hidden, drag-anywhere reporter that reads loop state. */
  const genRegenReporter = (opcode, labelText) => ({
    opcode,
    text: labelText,
    blockType: Scratch.BlockType.REPORTER,
    color1: "#1a1a2e",
    hideFromPalette: true,
    allowDropAnywhere: true,
    canDragDuplicate: true,
  });

  /**
   * Wrap a block definition so that any argument with { fillIn: "opcode" }
   * gets an XML shadow pre-populated with the matching regen reporter.
   * Returns [blockDef, xmlBlockDef] — spread into the blocks array.
   */
  const genXML = (blockJSON) => {
    let xmlBlock = `<block type="${EXT_ID}_${blockJSON.opcode}">`;
    for (const [name, arg] of Object.entries(blockJSON.arguments || {})) {
      if (arg.type === Scratch.ArgumentType.IMAGE) continue;
      if (arg.menu) {
        xmlBlock += `<field name="${name}">${arg.defaultValue ?? ""}</field>`;
      } else if (arg.fillIn) {
        // Insert the regen reporter as a shadow so it behaves like a variable pill
        xmlBlock += `<value name="${name}"><shadow type="${EXT_ID}_${arg.fillIn}"></shadow></value>`;
      } else {
        const twType   = arg.type === Scratch.ArgumentType.NUMBER ? "math_number" : "text";
        const twField  = arg.type === Scratch.ArgumentType.NUMBER ? "NUM"         : "TEXT";
        xmlBlock += `<value name="${name}"><shadow type="${twType}"><field name="${twField}">${arg.defaultValue ?? ""}</field></shadow></value>`;
      }
    }
    xmlBlock += "</block>";
    return [
      blockJSON,
      { blockType: Scratch.BlockType.XML, xml: xmlBlock }
    ];
  };

  // ─── Extension Class ───────────────────────────────────────────────────────

  class MidiExtension {
    constructor() {
      /** @type {Map<string, {raw: Uint8Array, parsed: object}>} */
      this._midis    = new Map();
      this._lastError = "";
    }

    getInfo() {
      return {
        id: EXT_ID,
        name: "MIDI",
        color1: "#1a1a2e",
        color2: "#16213e",
        color3: "#0f3460",
        menuIconURI:  "https://upload.wikimedia.org/wikipedia/commons/e/ec/Twemoji_1f3b9.svg",
        blockIconURI: "https://upload.wikimedia.org/wikipedia/commons/e/ec/Twemoji_1f3b9.svg",
        blocks: [

          // ── Regen reporters (hidden, drag-anywhere loop variable pills) ──
          genRegenReporter("midiLoopNote", "note"),
          genRegenReporter("midiLoopBeat", "beat"),
          genRegenReporter("midiLoopRest", "rest"),

          // ── Loading & Management ──────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "Loading & Management" },

          {
            opcode: "loadMidi",
            blockType: Scratch.BlockType.COMMAND,
            text: "load MIDI from [SOURCE] as [NAME]",
            arguments: {
              SOURCE: { type: Scratch.ArgumentType.STRING, defaultValue: "https://example.com/song.mid" },
              NAME:   { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },
          {
            opcode: "deleteMidi",
            blockType: Scratch.BlockType.COMMAND,
            text: "delete MIDI [NAME]",
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },
          {
            opcode: "midiExists",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "does [NAME] exist?",
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          "---",

          // ── File Info ─────────────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "File Info" },

          {
            opcode: "midiFormat",
            blockType: Scratch.BlockType.REPORTER,
            text: "format of [NAME]",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },
          {
            opcode: "midiTrackCount",
            blockType: Scratch.BlockType.REPORTER,
            text: "number of tracks in [NAME]",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },
          {
            opcode: "midiTicksPerBeat",
            blockType: Scratch.BlockType.REPORTER,
            text: "ticks per beat in [NAME]",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },
          {
            opcode: "midiTempo",
            blockType: Scratch.BlockType.REPORTER,
            text: "tempo of [NAME] in µs/beat",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },
          {
            opcode: "midiBPM",
            blockType: Scratch.BlockType.REPORTER,
            text: "BPM of [NAME]",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },
          {
            opcode: "midiTotalMessages",
            blockType: Scratch.BlockType.REPORTER,
            text: "total messages in [NAME]",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },

          // ── NEW: channel exists boolean ───────────────────────────────────
          {
            opcode: "channelExists",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "channel [CHANNEL] exists in [NAME]?",
            arguments: {
              CHANNEL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:    { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          "---",

          // ── Tracks ────────────────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "Tracks" },

          {
            opcode: "trackMessageCount",
            blockType: Scratch.BlockType.REPORTER,
            text: "message count in track [TRACK] of [NAME]",
            arguments: {
              TRACK: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },
          {
            opcode: "trackName",
            blockType: Scratch.BlockType.REPORTER,
            text: "name of track [TRACK] in [NAME]",
            arguments: {
              TRACK: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          // ── NEW: get note property reporter ──────────────────────────────
          {
            opcode: "getNoteInfo",
            blockType: Scratch.BlockType.REPORTER,
            text: "get note [INDEX] [NOTEPROP] in track [TRACK] of [NAME]",
            arguments: {
              INDEX:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NOTEPROP: { type: Scratch.ArgumentType.STRING, menu: "noteProps" },
              TRACK:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:     { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          // ── NEW: for each note C-block with fill-in variable pills ────────
          //  genXML wraps the block and produces an XML pre-build so
          //  the NOTE and BEAT slots start with the "note" and "beat"
          //  regen reporters already dropped in — just like SPjson's forEach.
          ...genXML({
            opcode: "forEachNote",
            blockType: Scratch.BlockType.LOOP,
            text: "for each [NOTEVAR] with [BEATVAR] duration and [RESTVAR] rest in [NAME]",
            hideFromPalette: true,
            arguments: {
              NOTEVAR: { fillIn: "midiLoopNote" },
              BEATVAR: { fillIn: "midiLoopBeat" },
              RESTVAR: { fillIn: "midiLoopRest" },
              NAME:    { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          }),

          // ── NEW: guess instrument reporter ───────────────────────────────
          {
            opcode: "guessInstrument",
            blockType: Scratch.BlockType.REPORTER,
            text: "guess music instrument from track [TRACK] name in [NAME]",
            arguments: {
              TRACK: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          "---",

          // ── Messages ──────────────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "Messages" },

          {
            opcode: "getMessage",
            blockType: Scratch.BlockType.REPORTER,
            text: "message [INDEX] of track [TRACK] in [NAME]",
            arguments: {
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              TRACK: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },
          {
            opcode: "getMessageField",
            blockType: Scratch.BlockType.REPORTER,
            text: "field [FIELD] of message [INDEX] in track [TRACK] of [NAME]",
            arguments: {
              FIELD: { type: Scratch.ArgumentType.STRING, menu: "messageFields" },
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              TRACK: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          "---",

          // ── Note Utilities ────────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "Note Utilities" },

          {
            opcode: "noteToName",
            blockType: Scratch.BlockType.REPORTER,
            text: "note name of [NOTE]",
            arguments: { NOTE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 60 } },
          },
          {
            opcode: "nameToNote",
            blockType: Scratch.BlockType.REPORTER,
            text: "note number of [NAME_STR]",
            arguments: { NAME_STR: { type: Scratch.ArgumentType.STRING, defaultValue: "C4" } },
          },

          "---",

          // ── Merged / Flat View ────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "Merged / Flat View" },

          {
            opcode: "flatMessageCount",
            blockType: Scratch.BlockType.REPORTER,
            text: "merged message count of [NAME]",
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" } },
          },
          {
            opcode: "getFlatMessage",
            blockType: Scratch.BlockType.REPORTER,
            text: "merged message [INDEX] of [NAME]",
            arguments: {
              INDEX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              NAME:  { type: Scratch.ArgumentType.STRING, defaultValue: "mySong" },
            },
          },

          "---",

          // ── Error Handling ────────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "Error Handling" },

          { opcode: "lastError", blockType: Scratch.BlockType.REPORTER, text: "last MIDI error" },
        ],

        menus: {
          noteProps: {
            acceptReporters: false,
            items: ["beat length", "seconds length", "velocity", "rest beat length", "rest seconds length"],
          },
          messageFields: {
            acceptReporters: true,
            items: [
              "type", "delta", "absoluteTick", "channel", "note", "velocity",
              "control", "value", "program", "pitch", "tempo", "bpm",
              "text", "metaName", "numerator", "denominator",
            ],
          },
        },
      };
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    _get(name) { return this._midis.get(String(name).trim()) ?? null; }
    _err(msg)  { this._lastError = msg; console.warn("[MidiExtension]", msg); }

    /** Build note-on list for a single parsed track, with pre-computed durations. */
    _buildNoteList(track, ppq) {
      let tick = 0;
      const absTrack = track.map((msg) => { tick += msg.delta; return { ...msg, absoluteTick: tick }; });

      const noteOns = absTrack.filter((m) => m.type === "note_on" && m.velocity > 0);

      // Build off-map: channel+note → sorted array of off-tick candidates
      const offMap = {};
      for (const m of absTrack) {
        if (m.type === "note_off" || (m.type === "note_on" && m.velocity === 0)) {
          const k = `${m.channel}-${m.note}`;
          if (!offMap[k]) offMap[k] = [];
          offMap[k].push(m.absoluteTick);
        }
      }
      for (const k of Object.keys(offMap)) offMap[k].sort((a, b) => a - b);

      return noteOns.map((on, idx) => {
        const k    = `${on.channel}-${on.note}`;
        const offs = offMap[k] || [];
        const offT = offs.find((t) => t > on.absoluteTick) ?? on.absoluteTick;
        const beatDuration = (offT - on.absoluteTick) / ppq;
        // Rest = gap between this note's off-tick and the next note's on-tick.
        // For the last note in the track, rest = 0.
        const nextOnTick = idx < noteOns.length - 1
          ? noteOns[idx + 1].absoluteTick : offT;
        const restBeats  = Math.max(0, (nextOnTick - offT) / ppq);
        return {
          note:     on.note,
          velocity: on.velocity,
          beats:    beatDuration,
          rest:     restBeats,
        };
      });
    }

    /** Resolve tempo in µs from any track. */
    _getTempo(entry) {
      for (const tr of entry.parsed.tracks)
        for (const m of tr)
          if (m.metaName === "set_tempo") return m.tempo;
      return 500000;
    }

    // ── Block implementations ─────────────────────────────────────────────────

    async loadMidi({ SOURCE, NAME }) {
      const src  = String(SOURCE).trim();
      const name = String(NAME).trim();
      if (!name) return;
      try {
        let bytes;
        if (/^data:/i.test(src) || (/^[A-Za-z0-9+/]/.test(src) && src.length > 100)) {
          bytes = base64ToBytes(src);
        } else {
          bytes = await fetchBytes(src);
        }
        const parsed = parseMidi(bytes);
        this._midis.set(name, { raw: bytes, parsed });
        this._lastError = "";
      } catch (e) {
        this._err(`loadMidi "${name}": ${e.message}`);
      }
    }

    deleteMidi({ NAME })  { this._midis.delete(String(NAME).trim()); }
    midiExists({ NAME })  { return this._midis.has(String(NAME).trim()); }

    midiFormat({ NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`midiFormat: "${NAME}" not found`); return ""; }
      return e.parsed.format;
    }
    midiTrackCount({ NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`midiTrackCount: "${NAME}" not found`); return 0; }
      return e.parsed.numTracks;
    }
    midiTicksPerBeat({ NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`midiTicksPerBeat: "${NAME}" not found`); return 0; }
      return e.parsed.timeDivision;
    }
    midiTempo({ NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`midiTempo: "${NAME}" not found`); return 0; }
      return this._getTempo(e);
    }
    midiBPM({ NAME }) {
      const tempo = this.midiTempo({ NAME }); return tempo ? Math.round(60000000 / tempo) : 0;
    }
    midiTotalMessages({ NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`midiTotalMessages: "${NAME}" not found`); return 0; }
      return e.parsed.tracks.reduce((s, t) => s + t.length, 0);
    }

    // ── NEW: channel exists ────────────────────────────────────────────────
    channelExists({ CHANNEL, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`channelExists: "${NAME}" not found`); return false; }
      const ch = Number(CHANNEL);
      for (const track of e.parsed.tracks)
        for (const msg of track)
          if (msg.channel === ch) return true;
      return false;
    }

    trackMessageCount({ TRACK, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`trackMessageCount: "${NAME}" not found`); return 0; }
      const track = e.parsed.tracks[Number(TRACK)];
      if (!track) { this._err(`trackMessageCount: track ${TRACK} not found`); return 0; }
      return track.length;
    }
    trackName({ TRACK, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`trackName: "${NAME}" not found`); return ""; }
      const track = e.parsed.tracks[Number(TRACK)];
      if (!track) { this._err(`trackName: track ${TRACK} not found`); return ""; }
      for (const msg of track) if (msg.metaName === "track_name") return msg.text;
      return "";
    }

    // ── NEW: get note property reporter ───────────────────────────────────
    getNoteInfo({ INDEX, NOTEPROP, TRACK, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`getNoteInfo: "${NAME}" not found`); return 0; }
      const track = e.parsed.tracks[Number(TRACK)];
      if (!track) { this._err(`getNoteInfo: track ${TRACK} not found`); return 0; }

      const ppq      = e.parsed.timeDivision;
      const tempoUs  = this._getTempo(e);
      const notes    = this._buildNoteList(track, ppq);
      const noteIdx  = Number(INDEX);

      if (noteIdx < 0 || noteIdx >= notes.length) {
        this._err(`getNoteInfo: note index ${INDEX} out of range (${notes.length} notes)`);
        return 0;
      }

      const { note, velocity, beats, rest } = notes[noteIdx];
      const prop = String(NOTEPROP).toLowerCase();

      if (prop === "velocity")            return velocity;
      if (prop === "beat length")         return beats;
      if (prop === "seconds length")      return beats * (tempoUs / 1_000_000);
      if (prop === "rest beat length")    return rest;
      if (prop === "rest seconds length") return rest  * (tempoUs / 1_000_000);

      this._err(`getNoteInfo: unknown property "${NOTEPROP}"`); return 0;
    }

    // ── NEW: for each note C-block with fill-in variable pills ─────────────
    //
    //  Each iteration sets two values on the outermost (loop) stack frame:
    //    midiLoopNote_value  → current note number (read by the "note" regen reporter)
    //    midiLoopBeat_value  → duration in beats   (read by the "beat" regen reporter)
    //
    //  This is the same pattern SharkPool uses in SPjson forEach:
    //  the regen reporters read util.thread.stackFrames[0].<key> which the
    //  C-block writes on every iteration before calling util.startBranch.
    forEachNote(args, util) {
      const name = String(args.NAME).trim();

      if (util.stackFrame.midiExecute) {
        // ── Continuing an already-started loop ──
        util.stackFrame.midiIndex++;
        const { midiIndex, midiNotes } = util.stackFrame;
        if (midiIndex > midiNotes.length - 1) return; // exhausted

        // Write current note into the outermost frame so regen reporters can read it
        util.thread.stackFrames[0].midiLoopNote_value = midiNotes[midiIndex].note;
        util.thread.stackFrames[0].midiLoopBeat_value = midiNotes[midiIndex].beats;
        util.thread.stackFrames[0].midiLoopRest_value = midiNotes[midiIndex].rest;

      } else {
        // ── First execution: build the merged note list ──
        const e = this._get(name);
        if (!e) { this._err(`forEachNote: "${name}" not found`); return; }

        const ppq = e.parsed.timeDivision;

        // Merge note lists across ALL tracks, sorted by absolute start tick
        const allMsgs = [];
        for (const track of e.parsed.tracks) {
          let tick = 0;
          for (const msg of track) {
            tick += msg.delta;
            allMsgs.push({ ...msg, absoluteTick: tick });
          }
        }
        allMsgs.sort((a, b) => a.absoluteTick - b.absoluteTick);

        const noteOns = allMsgs.filter((m) => m.type === "note_on" && m.velocity > 0);
        if (noteOns.length === 0) return;

        // Pre-build off-map for duration lookup
        const offMap = {};
        for (const m of allMsgs) {
          if (m.type === "note_off" || (m.type === "note_on" && m.velocity === 0)) {
            const k = `${m.channel}-${m.note}`;
            if (!offMap[k]) offMap[k] = [];
            offMap[k].push(m.absoluteTick);
          }
        }
        for (const k of Object.keys(offMap)) offMap[k].sort((a, b) => a - b);

        const midiNotes = noteOns.map((on, idx) => {
          const k    = `${on.channel}-${on.note}`;
          const offs = offMap[k] || [];
          const offT = offs.find((t) => t > on.absoluteTick) ?? on.absoluteTick;
          const beatDuration = (offT - on.absoluteTick) / ppq;
          const nextOnTick = idx < noteOns.length - 1
            ? noteOns[idx + 1].absoluteTick : offT;
          const restBeats  = Math.max(0, (nextOnTick - offT) / ppq);
          return { note: on.note, beats: beatDuration, rest: restBeats };
        });

        // Write the first note to the outer frame before branch starts
        util.thread.stackFrames[0].midiLoopNote_value = midiNotes[0].note;
        util.thread.stackFrames[0].midiLoopBeat_value = midiNotes[0].beats;
        util.thread.stackFrames[0].midiLoopRest_value = midiNotes[0].rest;

        // Stash loop state on the current (inner) stack frame
        util.stackFrame.midiExecute = true;
        util.stackFrame.midiNotes   = midiNotes;
        util.stackFrame.midiIndex   = 0;
      }

      // Run the branch body; pass true so Scratch knows to come back here
      util.startBranch(1, true);
    }

    // ── Regen reporter implementations ────────────────────────────────────
    //  These are called when the drag-and-drop "note" / "beat" pills are evaluated.
    //  They read their value from the outermost stack frame, exactly as SPjson does.
    midiLoopNote(_, util) {
      return util.thread.stackFrames[0].midiLoopNote_value ?? "";
    }
    midiLoopBeat(_, util) {
      return util.thread.stackFrames[0].midiLoopBeat_value ?? "";
    }
    midiLoopRest(_, util) {
      return util.thread.stackFrames[0].midiLoopRest_value ?? "";
    }

    // ── NEW: guess instrument reporter ────────────────────────────────────
    guessInstrument({ TRACK, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`guessInstrument: "${NAME}" not found`); return 1; }
      const track = e.parsed.tracks[Number(TRACK)];
      if (!track) { this._err(`guessInstrument: track ${TRACK} not found`); return 1; }
      return guessInstrumentFromTrack(track);
    }

    // ── Existing message blocks ───────────────────────────────────────────
    getMessage({ INDEX, TRACK, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`getMessage: "${NAME}" not found`); return "{}"; }
      const track = e.parsed.tracks[Number(TRACK)];
      if (!track) { this._err(`getMessage: track ${TRACK} not found`); return "{}"; }
      const msg = track[Number(INDEX)];
      if (!msg) { this._err(`getMessage: index ${INDEX} out of range`); return "{}"; }
      const out = { ...msg };
      if (out.data instanceof Uint8Array) out.data = Array.from(out.data);
      return JSON.stringify(out);
    }

    getMessageField({ FIELD, INDEX, TRACK, NAME }) {
      try {
        const obj = JSON.parse(this.getMessage({ INDEX, TRACK, NAME }));
        const val = obj[String(FIELD)];
        return val !== undefined ? String(val) : "";
      } catch { return ""; }
    }

    noteToName({ NOTE }) {
      return noteToName(Math.max(0, Math.min(127, Number(NOTE))));
    }

    nameToNote({ NAME_STR }) {
      const s     = String(NAME_STR).trim().toUpperCase();
      const match = s.match(/^([A-G]#?)(-?\d+)$/);
      if (!match) { this._err(`nameToNote: invalid note "${NAME_STR}"`); return -1; }
      const idx = NOTE_NAMES.indexOf(match[1]);
      if (idx === -1) { this._err(`nameToNote: unknown note "${match[1]}"`); return -1; }
      return (parseInt(match[2], 10) + 1) * 12 + idx;
    }

    flatMessageCount({ NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`flatMessageCount: "${NAME}" not found`); return 0; }
      return mergeToFlat(e.parsed).length;
    }

    getFlatMessage({ INDEX, NAME }) {
      const e = this._get(NAME); if (!e) { this._err(`getFlatMessage: "${NAME}" not found`); return "{}"; }
      const flat = mergeToFlat(e.parsed);
      const msg  = flat[Number(INDEX)];
      if (!msg) { this._err(`getFlatMessage: index ${INDEX} out of range`); return "{}"; }
      const out = { ...msg };
      if (out.data instanceof Uint8Array) out.data = Array.from(out.data);
      return JSON.stringify(out);
    }

    lastError() { return this._lastError; }
  }

  // ─── Register ──────────────────────────────────────────────────────────────
  Scratch.extensions.register(new MidiExtension());
})(Scratch);
