// Hides credentials in text before anyone sees or copies it (0.22.0). Router
// and provider errors can quote a token back; every toast, inline message,
// dialog body and copy goes through this one function. Pure, so tests run it
// directly. Placeholders ("<your key>", "$OMNIROUTE_API_KEY") are left alone.
// 0.22.1: a quoted value is hidden whole, Authorization takes any scheme,
// CLI flags (--api-key X, ["--token", "X"]) count, and names match as whole
// words, so "tokenizer", "monkey", "keyboard" and "author" stay visible.
// 0.22.2: flags are read word by word, so one flag never hides the next.

export const REDACTED = "[hidden]";

/** Whole words that make a name hold a secret: api_key, apiKey, x-api-key, MY_SERVICE_TOKEN, client-secret, --auth… */
const SECRET_WORDS = new Set([
  "key", "apikey", "accesskey", "secretkey", "privatekey",
  "token", "accesstoken", "authtoken", "refreshtoken", "idtoken", "bearertoken",
  "password", "passwd", "pwd", "passphrase",
  "secret", "clientsecret",
  "credential", "credentials",
  "auth", "authorization", "bearer",
]);

/** "x-api-key" → ["x", "api", "key"]; "apiKey" → ["api", "key"]; "APIKey" → ["api", "key"]. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
/** True when a whole word of the name is a secret word ("api_key" yes, "monkey" and "tokenizer" no). */
export function isSecretName(name: string): boolean {
  return nameWords(name).some((word) => SECRET_WORDS.has(word));
}

/** A value that is a placeholder, not a secret. */
const PLACEHOLDER = /^(?:<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\[hidden\]?|…\w{0,4}|\*+|none|null|undefined|true|false)$/i;
/** An environment variable's name ("OMNIROUTE_API_KEY"): where a key goes, not the key. */
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const keep = (value: string) => !value || PLACEHOLDER.test(value) || ENV_NAME.test(value);
/** After a bare "name: " (prose as much as code), only a value shaped like a secret: 8+ characters with a digit, or 20+. */
const SECRETISH = (value: string) => (value.length >= 8 && /\d/.test(value)) || value.length >= 20;
/** Words after "--token " in a sentence ("pass --token to the CLI"): not values. */
const PROSE = new Set(["to", "for", "and", "or", "the", "with", "in", "on", "of", "is", "as", "if", "when", "from", "flag", "option", "set", "here", "instead"]);

/** A double- or single-quoted span, escapes included, on one line. */
const QUOTED = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`;
const quoted = (value: string) => /^["']/.test(value);
const hideQuoted = (value: string) => `${value[0]}${REDACTED}${value[0]}`;

/** Authorization (and Proxy-Authorization) with any scheme, short values included: the scheme stays, the value goes. */
const AUTH_HEADER = new RegExp(String.raw`(\b(?:proxy-)?authorization(["']?)\s*[:=]\s*)(${QUOTED}|<[^>\n]*>|[A-Za-z][A-Za-z0-9._-]*[ \t]+[A-Za-z][A-Za-z0-9_-]*=[^\n]*|(?:[A-Za-z][A-Za-z0-9._-]*[ \t]+)?[^\s"',;)}\]]+)`, "gi");

/** name = value, name: value, "name": "value", name='value' (env, JSON, TOML, YAML, query strings). */
const PAIR = new RegExp(String.raw`(\b([A-Za-z][A-Za-z0-9_.-]*)(["']?)\s*([=:])\s*)(${QUOTED}|<[^>\n]*>|[^\s"'&,;)}\]]+)`, "g");

// ---------------------------------------------------------- CLI flags (0.22.2)
// Per word, never one pattern across two flags: in "--verbose --api-key X"
// the old pattern took "--api-key" as --verbose's value and never looked at
// it. The word after a secret flag is always its value, even "-x" or "a b c"
// in quotes; only a placeholder or the next word of a sentence is kept.

const FLAG = /^--?[A-Za-z][A-Za-z0-9_-]*$/;
const FLAG_EQ = /^(--?[A-Za-z][A-Za-z0-9_-]*)=(.*)$/s;
const isSecretFlag = (word: string) => FLAG.test(word) && isSecretName(word);
type Edit = { start: number; end: number; text: string };
const applyEdits = (text: string, edits: Edit[]) => edits.sort((a, b) => b.start - a.start).reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), text);

/** Where the quote opened at `from` closes (double quotes honour backslash escapes), or -1 on this line. */
function closingQuote(text: string, from: number): number {
  const quote = text[from];
  for (let i = from + 1; i < text.length && text[i] !== "\n"; i += 1) {
    if (quote === '"' && text[i] === "\\") i += 1;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/**
 * Shell-like words: split on whitespace, a quote at the start of a word (or
 * right after "=") runs to its closing quote, and a backslash keeps the next
 * character. A quote in the middle of a word ("don't") is just a character,
 * and a "<placeholder with spaces>" is one word.
 */
export function shellWords(text: string): Array<{ start: number; end: number; raw: string }> {
  const words: Array<{ start: number; end: number; raw: string }> = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && !/\s/.test(text[i])) {
      const c = text[i];
      if (c === "<" && i === start && /^<[^<>\n]*>/.test(text.slice(i))) {
        // A placeholder such as "<your key>" is one word.
        i = text.indexOf(">", i) + 1;
      } else if ((c === '"' || c === "'") && (i === start || text[i - 1] === "=")) {
        const close = closingQuote(text, i);
        i = close === -1 ? i + 1 : close + 1;
      } else i += c === "\\" ? 2 : 1;
    }
    i = Math.min(i, text.length);
    words.push({ start, end: i, raw: text.slice(start, i) });
  }
  return words;
}

/** A value word masked in place: its quotes and any trailing ",;)]}" stay. Null when it should stay as it is. */
function maskValue(raw: string, sentence: boolean): string | null {
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const close = closingQuote(raw, 0);
    if (close === -1) return REDACTED;
    return keep(raw.slice(1, close)) ? null : `${raw[0]}${REDACTED}${raw[0]}${raw.slice(close + 1)}`;
  }
  const [, value, tail] = raw.match(/^(.*?)([,;)\]}]*)$/s) ?? [raw, raw, ""];
  if (!value || keep(value) || value === REDACTED) return null;
  if (sentence && PROSE.has(value.replace(/[.,:!?]+$/, "").toLowerCase())) return null;
  return `${REDACTED}${tail}`;
}

/** In a command string: the word after each secret flag, and the value of each secret --flag=value. */
function maskFlagWords(text: string): string {
  const words = shellWords(text);
  const edits: Edit[] = [];
  words.forEach((word, index) => {
    const bare = word.raw.replace(/^[(\[{]+/, "");
    const lead = word.raw.length - bare.length;
    const eq = bare.match(FLAG_EQ);
    if (eq && isSecretName(eq[1]) && eq[2]) {
      const masked = maskValue(eq[2], false);
      if (masked !== null) edits.push({ start: word.start + lead + eq[1].length + 1, end: word.end, text: masked });
      return;
    }
    const next = words[index + 1];
    if (!next || !isSecretFlag(bare)) return;
    // A value that is itself a secret flag is masked here and still read as a flag for the word after it.
    const masked = maskValue(next.raw, !next.raw.startsWith("-"));
    if (masked !== null) edits.push({ start: next.start, end: next.end, text: masked });
  });
  return edits.length ? applyEdits(text, edits) : text;
}

/** In an argument list: ["--api-key", "X"] and ['--token', '-x'] → the element after each secret flag. */
function maskFlagArrays(text: string): string {
  const elements = [...text.matchAll(new RegExp(QUOTED, "g"))].map((m) => ({ start: m.index!, end: m.index! + m[0].length, raw: m[0] }));
  const edits: Edit[] = [];
  for (let k = 0; k + 1 < elements.length; k += 1) {
    const flag = elements[k].raw.slice(1, -1);
    if (!isSecretFlag(flag) || !/^\s*,\s*$/.test(text.slice(elements[k].end, elements[k + 1].start))) continue;
    const value = elements[k + 1].raw;
    if (!keep(value.slice(1, -1))) edits.push({ start: elements[k + 1].start, end: elements[k + 1].end, text: hideQuoted(value) });
  }
  return edits.length ? applyEdits(text, edits) : text;
}

const RULES: Array<(text: string) => string> = [
  // https://user:pass@host → https://[hidden]@host
  (text) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`),
  // Authorization: Bearer abc / Token abc / abc / "Basic abc"
  (text) =>
    text.replace(AUTH_HEADER, (match, head: string, _quote: string, value: string) => {
      if (quoted(value)) return keep(value.slice(1, -1)) ? match : `${head}${hideQuoted(value)}`;
      if (keep(value)) return match;
      // "Digest username=…, response=…" (or any scheme with parameters): everything after the scheme.
      const [scheme, ...rest] = value.split(/[ \t]+/);
      const secret = rest.length ? rest.join(" ") : scheme;
      if (keep(secret)) return match;
      return `${head}${rest.length ? `${scheme} ` : ""}${REDACTED}`;
    }),
  // Bearer abc / Basic abc anywhere else
  (text) => text.replace(/\b(Bearer|Basic)\s+(?!\[hidden\])[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`),
  // JWTs, whole: header.payload[.signature]
  (text) => text.replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)?/g, REDACTED),
  // sk-…, sk-ant-…, rk-…, pk-… keys
  (text) => text.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, REDACTED),
  // ["--api-key", "X"], ['--token', '-x']
  maskFlagArrays,
  // --api-key X, --token "a b c", --secret -x, --password=X: word by word
  maskFlagWords,
  // api_key=abc, "token": "a b c", password='x', MY_SERVICE_TOKEN=x, ?access_token=abc&…
  (text) =>
    text.replace(PAIR, (match, head: string, name: string, nameQuote: string, sep: string, value: string) => {
      if (!isSecretName(name) || nameWords(name).includes("authorization")) return match;
      if (quoted(value)) return keep(value.slice(1, -1)) ? match : `${head}${hideQuoted(value)}`;
      if (keep(value) || value === REDACTED) return match;
      // "=" and a quoted name are code or a query string; a bare "token: x" may be a sentence.
      const code = sep === "=" || !!nameQuote;
      return code || SECRETISH(value) ? `${head}${REDACTED}` : match;
    }),
  // Long hex: 32+ characters, except a git commit named as one ("--ref 56bc…", "#56bc…", "@56bc…", "/commit/56bc…")
  (text) => text.replace(/(--ref[ =]|[#@]|\/(?:commit|tree)\/)?\b([0-9a-f]{32,})\b/gi, (match, ref: string | undefined) => (ref ? match : REDACTED)),
  // Long base64 / base64url segments: 32+ characters with upper, lower and a digit (paths and ids rarely mix all three)
  (text) => text.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (run) => (/[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run) ? REDACTED : run)),
];

/** The text with every credential-looking part replaced by "[hidden]". */
export function redactSecrets(text: string): string {
  if (typeof text !== "string" || !text) return text;
  return RULES.reduce((out, rule) => rule(out), text);
}

/** Strings redacted, anything else (React elements, numbers, arrays of either) as it was. */
export function redactNode<T>(node: T): T {
  if (typeof node === "string") return redactSecrets(node) as T;
  if (Array.isArray(node)) return node.map(redactNode) as T;
  return node;
}
