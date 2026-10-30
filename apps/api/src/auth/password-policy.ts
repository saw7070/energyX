/**
 * What a new or changed password must meet. Existing passwords are never re-checked: people keep signing in with
 * what they have until they next change it.
 */

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Passwords at or above the minimum length that appear near the top of every leaked-password list, compared in lower
 * case. Short on purpose: it stops the guesses attackers try first, not every weak password.
 */
const COMMON_PASSWORDS = new Set([
  "000000000000", "111111111111", "123123123123", "123456789012", "1234567890123", "12345678901234",
  "123456789123", "1234567891011", "123456123456", "123412341234", "987654321098", "121212121212",
  "qwertyuiop12", "qwertyuiop123", "qwertyuiopasdf", "qwerty123456", "qwerty1234567", "qwertyqwerty",
  "1q2w3e4r5t6y", "q1w2e3r4t5y6", "1qaz2wsx3edc", "zaq12wsxcde3", "1qazxsw23edc", "qazwsxedcrfv",
  "asdfghjkl123", "asdfasdfasdf", "1234qwerasdf", "qwer1234asdf", "abcdefghijkl", "abc123456789",
  "abcd12345678", "abcdef123456", "password1234", "password12345", "password123456", "passwordpassword",
  "password123!", "password@123", "password2024", "password2025", "password2026", "p@ssw0rd1234",
  "p@ssword1234", "p@ssw0rd123!", "passw0rd1234", "mypassword123", "mypassword12", "newpassword1",
  "newpassword123", "iloveyou1234", "iloveyou12345", "welcome12345", "welcome123456", "welcome@1234",
  "welcome@12345", "letmein12345", "changeme1234", "changeme123!", "administrator", "administrator1",
  "admin1234567", "admin@123456", "adminadmin123", "superman1234", "football1234", "baseball1234",
  "sunshine1234", "princess1234", "monkey123456", "dragon123456", "starwars1234", "whatever1234",
  "computer1234", "internet1234", "secret123456", "test12345678", "testtest1234", "temp12345678",
  "singapore123", "singapore1234", "malaysia1234", "energyx12345", "energyx123456",
]);

/** Why `password` cannot be used as a new password, in words for the person typing it, or undefined if it can. */
export function passwordPolicyProblem(password: string, context: { email?: string | undefined } = {}): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  const normalized = password.trim().toLowerCase();
  const email = context.email?.trim().toLowerCase();
  if (
    COMMON_PASSWORDS.has(normalized)
    || /^(.)\1+$/u.test(normalized)
    || (email !== undefined && (normalized === email || normalized === email.split("@")[0]))
  ) {
    return "This password is too easy to guess. Choose one that is less common.";
  }
  return undefined;
}
