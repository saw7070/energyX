import Link from "next/link";
import { LEGAL_DOCUMENTS } from "./documents";
import styles from "./legal.module.css";

export default function LegalIndex() {
  return <main className={styles.layout} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
    <div className={styles.doc}>
      <h1>Legal &amp; security</h1>
      <p className={styles.summary}>How EnergyX handles your data, what we promise, and how we keep it safe.</p>
      <div className={styles.cards}>
        {LEGAL_DOCUMENTS.map(document => <Link key={document.id} href={`/legal/${document.id}`} className={styles.card}>
          <strong>{document.title}</strong><span>{document.summary}</span>
        </Link>)}
      </div>
    </div>
  </main>;
}
