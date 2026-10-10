import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { COMPANY } from "./company";
import { LEGAL_DOCUMENTS } from "./documents";
import { LegalIcon } from "./legal-icons";
import { LegalText } from "./LegalText";
import styles from "./legal.module.css";

export const metadata = { title: "Trust center" };

const TOP_LINKS = ["privacy", "security", "ai-use", "service-levels"];

/** The API's session cookie (apps/api/src/auth/cookies.ts); its presence is enough to offer the way back into the app. */
const SESSION_COOKIE = "df_session";

export default async function LegalLayout({ children }: { children: ReactNode }) {
  const company = COMPANY.name || "EnergyX";
  // Signed-in readers go back to the app; everyone else is offered sign-in. An expired session simply lands on sign-in.
  const signedIn = (await cookies()).has(SESSION_COOKIE) || process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE === "dev";
  return <div className={styles.page}>
    <header className={styles.top}>
      <div className={styles.topInner}>
        <Link href="/legal" className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">X</span>
          <span>EnergyX</span>
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.brandSub}>Trust center</span>
        </Link>
        <nav className={styles.topNav} aria-label="Trust center">
          {TOP_LINKS.map(id => {
            const document = LEGAL_DOCUMENTS.find(item => item.id === id);
            return document ? <Link key={id} href={`/legal/${id}`}>{document.title.replace(/ policy| overview/u, "")}</Link> : null;
          })}
        </nav>
        {signedIn
          ? <Link href="/energyiq" className={styles.signIn}>Open EnergyX <LegalIcon name="arrow" width={15} height={15} /></Link>
          : <Link href="/login" className={styles.signIn}>Sign in <LegalIcon name="arrow" width={15} height={15} /></Link>}
      </div>
    </header>
    {children}
    <footer className={styles.foot}>
      <div className={styles.footInner}>
        <div className={styles.footBrand}>
          <span className={styles.logo} aria-hidden="true">X</span>
          <p>Energy analytics for buildings in Singapore and Malaysia, from metered readings you can trust.</p>
        </div>
        <div>
          <h2>Policies</h2>
          {LEGAL_DOCUMENTS.filter(item => ["privacy", "terms", "data-processing", "ai-use"].includes(item.id)).map(item => <Link key={item.id} href={`/legal/${item.id}`}>{item.title}</Link>)}
        </div>
        <div>
          <h2>Security</h2>
          <Link href="/legal/security">Security overview</Link>
          <Link href="/legal/service-levels">Service levels</Link>
          <a href="/.well-known/security.txt">security.txt</a>
        </div>
        <div>
          <h2>Contact</h2>
          <span><LegalText text="{contactEmail}" /></span>
          <span className={styles.footMuted}>Security: <LegalText text="{securityEmail}" /></span>
        </div>
      </div>
      <div className={styles.footBar}>
        <span>© {new Date().getFullYear()} {company}</span>
        <span>Hosted on Alibaba Cloud · Built for PDPA in Singapore and Malaysia</span>
      </div>
    </footer>
  </div>;
}
