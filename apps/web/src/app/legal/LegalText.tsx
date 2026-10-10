import { Fragment } from "react";
import { COMPANY, COMPANY_LABELS, type CompanyField } from "./company";
import styles from "./legal.module.css";

/** Text with {field} company details filled in, or shown as a highlighted blank while still empty. */
export function LegalText({ text }: { text: string }) {
  return <>{text.split(/(\{[a-zA-Z]+\})/u).map((part, index) => {
    const field = /^\{([a-zA-Z]+)\}$/u.exec(part)?.[1] as CompanyField | undefined;
    if (!field || !(field in COMPANY)) return <Fragment key={index}>{part}</Fragment>;
    return COMPANY[field] ? <Fragment key={index}>{COMPANY[field]}</Fragment> : <mark key={index} className={styles.blank}>[{COMPANY_LABELS[field]}]</mark>;
  })}</>;
}

/** True while any company detail a document needs is still blank. */
export const hasBlanks = (texts: string[]): boolean =>
  texts.some(text => [...text.matchAll(/\{([a-zA-Z]+)\}/gu)].some(([, field]) => field && field in COMPANY && !COMPANY[field as CompanyField]));
