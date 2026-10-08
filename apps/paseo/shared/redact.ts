// Hides credentials in text before anyone sees or copies it (0.22.0). Router
// and provider errors can quote a token back; every toast, inline message,
// dialog body and copy goes through this one function. Pure, so tests run it
// directly. Placeholders ("<your key>", "$OMNIROUTE_API_KEY") are left alone.

export const REDACTED = "[hidden]";

/** A name that holds a secret: api_key, apiKey, x-api-key, token, access_token, password, secret, AI_ROUTER_KEY… */
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:key|token|password|passwd|pwd|secret|credential|auth)[A-Za-z0-9_.-]*`;
/** A value that is a placeholder, not a secret. */
const PLACEHOLDER = /^(?:<[^>]*>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\[hidden\]?|…\w{0,4}|\*+|Bearer|Basic|none|null|undefined|true|false)$/i;
/** An environment variable's name ("OMNIROUTE_API_KEY"): where a key goes, not the key. */
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
/** After a bare "name: " (prose as much as code), only a value shaped like a secret: 8+ characters with a digit, or 20+. */
const SECRETISH = (value: string) => (value.length >= 8 && /\d/.test(value)) || value.length >= 20;

const RULES: Array<(text: string) => string> = [
  // https://user:pass@host → https://[hidden]@host
  (text) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`),
  // Authorization: Bearer abc / Basic abc
  (text) => text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`),
  // JWTs, whole: header.payload[.signature]
  (text) => text.replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)?/g, REDACTED),
  // sk-…, sk-ant-…, rk-…, pk-… keys
  (text) => text.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, REDACTED),
  // api_key=abc, "token": "abc", password: abc, ?access_token=abc&… (placeholders kept)
  (text) =>
    text.replace(new RegExp(String.raw`(\b${SECRET_NAME}(["']?)\s*([=:])\s*(["']?))(<[^>\n]*>|[^\s"'&,;)}\]]+)`, "gi"), (match, head: string, nameQuote: string, sep: string, valueQuote: string, value: string) => {
      if (PLACEHOLDER.test(value) || ENV_NAME.test(value) || value.length < 4) return match;
      // "=" and quoted values are code or a query string; a bare "token: x" may be a sentence.
      const code = sep === "=" || !!nameQuote || !!valueQuote;
      return code || SECRETISH(value) ? `${head}${REDACTED}` : match;
    }),
  // Long hex: 32+ characters, except a git commit named as one ("--ref 56bc…", "#56bc…", "@56bc…", "/commit/56bc…")
  (text) => text.replace(/(--ref[ =]|[#@]|\/(?:commit|tree)\/)?\b([0-9a-f]{32,})\b/gi, (match, ref: string | undefined) => (ref ? match : REDACTED)),
  // Long base64 / base64url / JWT segments: 32+ characters with upper, lower and a digit (paths and ids rarely mix all three)
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
