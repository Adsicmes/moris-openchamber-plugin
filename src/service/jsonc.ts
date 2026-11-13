/**
 * Minimal JSONC reader for OpenCode's `opencode.jsonc`. It strips comments
 * and trailing commas outside strings, then hands the text to `JSON.parse`.
 * Anything malformed throws, so a present-but-broken file is never mistaken
 * for "no configuration".
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }

    if (char === ',') {
      let look = index + 1;
      while (look < text.length) {
        const candidate = text[look] as string;
        if (candidate === ' ' || candidate === '\t' || candidate === '\r' || candidate === '\n') {
          look += 1;
          continue;
        }
        if (candidate === '/' && text[look + 1] === '/') {
          while (look < text.length && text[look] !== '\n') look += 1;
          continue;
        }
        if (candidate === '/' && text[look + 1] === '*') {
          look += 2;
          while (look < text.length && !(text[look] === '*' && text[look + 1] === '/')) look += 1;
          look += 2;
          continue;
        }
        break;
      }
      if (text[look] === '}' || text[look] === ']') {
        index += 1;
        continue;
      }
    }

    out += char;
    index += 1;
  }

  return JSON.parse(out);
}
