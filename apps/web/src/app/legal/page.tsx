import Link from "next/link";
import { LEGAL_DOCUMENTS, type LegalDocument } from "./documents";
import { DOCUMENT_META, LegalIcon, type LegalIconName } from "./legal-icons";
import { LegalText } from "./LegalText";
import styles from "./legal.module.css";

const COMMITMENTS: Array<{ icon: LegalIconName; text: string }> = [
  { icon: "shield", text: "PDPA · Singapore & Malaysia" },
  { icon: "gauge", text: "99.5% uptime promise" },
  { icon: "backup", text: "Encrypted offsite backups" },
  { icon: "spark", text: "AI you control" },
];

const FACTS: Array<{ icon: LegalIconName; title: string; body: string }> = [
  { icon: "lock", title: "Encrypted in transit", body: "HTTPS everywhere with TLS 1.2 or later and HTTP Strict Transport Security." },
  { icon: "key", title: "Secrets locked away", body: "Passwords stored only as Argon2id hashes; connection keys encrypted with AES-256-GCM." },
  { icon: "backup", title: "Backed up every night", body: "7 days on the server and 35 days offsite, encrypted. Recover within 4 hours, at most 24 hours lost." },
  { icon: "users", title: "Access by role, with a record", body: "Each organisation's data kept separate, roles per person, and an audit history of who did what." },
];

export default function LegalIndex() {
  const group = (name: "policies" | "assurance") => LEGAL_DOCUMENTS.filter(document => DOCUMENT_META[document.id]?.group === name);
  return <main className={styles.indexMain}>
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <span className={styles.eyebrow}>Trust center</span>
        <h1>Your energy data, handled with care</h1>
        <p>How EnergyX protects your data, what we promise, and how we use AI, written for your IT, legal and procurement teams.</p>
        <ul className={styles.commitments}>
          {COMMITMENTS.map(item => <li key={item.text}><LegalIcon name={item.icon} width={16} height={16} />{item.text}</li>)}
        </ul>
      </div>
    </section>

    <div className={styles.indexBody}>
      <DocumentGroup title="Policies & agreements" intro="What we collect and why, the terms of the service, how we process data for you, and how AI is used." documents={group("policies")} />
      <DocumentGroup title="Security & reliability" intro="How the service is protected and kept running, and what we commit to." documents={group("assurance")} wide />

      <section className={styles.group} aria-labelledby="facts-title">
        <header className={styles.groupHeader}>
          <h2 id="facts-title">At a glance</h2>
          <p>The safeguards customers ask about most.</p>
        </header>
        <div className={styles.facts}>
          {FACTS.map(fact => <div key={fact.title} className={styles.fact}>
            <span className={styles.factIcon}><LegalIcon name={fact.icon} /></span>
            <strong>{fact.title}</strong>
            <p>{fact.body}</p>
          </div>)}
        </div>
      </section>

      <section className={styles.contact} aria-labelledby="contact-title">
        <div>
          <h2 id="contact-title">Questions, or need our security questionnaire?</h2>
          <p>Our team answers privacy, security and procurement questions, and can share a completed security questionnaire and our Data processing agreement for signature.</p>
        </div>
        <div className={styles.contactLinks}>
          <span><LegalIcon name="mail" width={18} height={18} /><span><small>Privacy & data protection</small><LegalText text="{dpoEmail}" /></span></span>
          <span><LegalIcon name="shield" width={18} height={18} /><span><small>Report a security issue</small><LegalText text="{securityEmail}" /></span></span>
        </div>
      </section>
    </div>
  </main>;
}

function DocumentGroup({ title, intro, documents, wide = false }: { title: string; intro: string; documents: LegalDocument[]; wide?: boolean }) {
  return <section className={styles.group}>
    <header className={styles.groupHeader}>
      <h2>{title}</h2>
      <p>{intro}</p>
    </header>
    <div className={`${styles.cards} ${wide ? styles.cardsTwo : ""}`}>
      {documents.map(document => {
        const meta = DOCUMENT_META[document.id];
        return <Link key={document.id} href={`/legal/${document.id}`} className={styles.card}>
          <span className={`${styles.cardIcon} ${meta ? styles[meta.tone] : ""}`}><LegalIcon name={meta?.icon ?? "document"} /></span>
          <strong>{document.title}</strong>
          <span className={styles.cardText}>{document.summary}</span>
          <span className={styles.cardLink}>Read <LegalIcon name="arrow" width={15} height={15} /></span>
        </Link>;
      })}
    </div>
  </section>;
}
