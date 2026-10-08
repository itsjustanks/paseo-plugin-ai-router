// Hides credentials in text before anyone sees or copies it (0.22.0). Router
// and provider errors can quote a token back; every toast, inline message,
// dialog body and copy goes through this one function. Pure, so tests run it
// directly. Placeholders ("<your key>", "$OMNIROUTE_API_KEY") are left alone.
// 0.22.1: a quoted value is hidden whole, Authorization takes any scheme,
// CLI flags (--api-key X, ["--token", "X"]) count, and names match as whole
// words, so "tokenizer", "monkey", "keyboard" and "author" stay visible.

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

/** A secret CLI flag and its value: --api-key X, --token "X", or in an array: ["--password", "X"]. (--flag=X is a PAIR.) */
const FLAG_ARRAY = new RegExp(String.raw`(["'])(--?[A-Za-z][A-Za-z0-9_-]*)\1(\s*,\s*)(${QUOTED})`, "g");
const FLAG_ARGS = new RegExp(String.raw`(^|[\s(\[{])(--?[A-Za-z][A-Za-z0-9_-]*)([ \t]+)(${QUOTED}|<[^>\n]*>|[^\s"',;)}\]]+)`, "g");

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
  // ["--api-key", "X"] → ["--api-key", "[hidden]"]
  (text) =>
    text.replace(FLAG_ARRAY, (match, quote: string, flag: string, comma: string, value: string) => {
      const inner = value.slice(1, -1);
      if (!isSecretName(flag) || keep(inner) || inner.startsWith("-")) return match;
      return `${quote}${flag}${quote}${comma}${hideQuoted(value)}`;
    }),
  // --api-key X, --token "X Y" → the value hidden (not another flag, a placeholder or the next word of a sentence)
  (text) =>
    text.replace(FLAG_ARGS, (match, lead: string, flag: string, gap: string, value: string) => {
      if (!isSecretName(flag)) return match;
      if (quoted(value)) return keep(value.slice(1, -1)) ? match : `${lead}${flag}${gap}${hideQuoted(value)}`;
      if (keep(value) || value.startsWith("-") || PROSE.has(value.replace(/[.,:!?]+$/, "").toLowerCase())) return match;
      return `${lead}${flag}${gap}${REDACTED}`;
    }),
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
