const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Encode a positive integer into a base62 short code.
 */
function encode(n) {
  let out = "";
  while (n > 0) {
    out = ALPHABET[n % ALPHABET.length] + out;
    n = Math.floor(n / ALPHABET.length);
  }
  return out;
}

function decode(code) {
  let n = 0;
  for (const ch of code) {
    n = n * ALPHABET.length + ALPHABET.indexOf(ch);
  }
  return n;
}

/**
 * Codes are derived from a monotonically increasing counter, offset so that
 * the first few codes are not one character long.
 */
const OFFSET = 100000;

function codeFor(sequence) {
  return encode(sequence + OFFSET);
}

module.exports = { encode, decode, codeFor, ALPHABET };
