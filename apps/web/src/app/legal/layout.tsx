import Link from "next/link";
import type { ReactNode } from "react";
import { COMPANY } from "./company";
import styles from "./legal.module.css";

export const metadata = { title: "Legal & security" };

export default function LegalLayout({ children }: { children: ReactNode }) {
  return <div className={styles.page}>
    <header className={styles.top}>
      <Link href="/legal" className={styles.brand}><span aria-hidden="true">X</span>EnergyX · Legal &amp; security</Link>
      <Link href="/login" className={styles.signIn}>Sign in →</Link>
    </header>
    {children}
    <footer className={styles.foot}>© {new Date().getFullYear()} {COMPANY.name || "EnergyX"}</footer>
  </div>;
}
