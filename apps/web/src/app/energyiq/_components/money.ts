/** The short mark people expect in front of an amount: S$ for Singapore dollars, RM for ringgit. */
const MARKS: Record<string, string> = { SGD: "S$", MYR: "RM" };

export const currencyMark = (currency: string): string => {
  const code = currency.trim().toUpperCase();
  return MARKS[code] ?? code;
};

/** An already-formatted number with its currency: "S$1,234", "RM1,234", or "USD 1,234" for codes without a mark. */
export const withCurrency = (currency: string, formattedValue: string): string => {
  const code = currency.trim().toUpperCase();
  const mark = MARKS[code];
  return mark ? `${mark}${formattedValue}` : `${code} ${formattedValue}`;
};
