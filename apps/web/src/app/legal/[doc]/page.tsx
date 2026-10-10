import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPANY } from "../company";
import { LEGAL_DOCUMENTS } from "../documents";
import { hasBlanks, LegalText } from "../LegalText";
import styles from "../legal.module.css";

export const dynamicParams = false;
export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map(document => ({ doc: document.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const document = LEGAL_DOCUMENTS.find(item => item.id === doc);
  return { title: document ? `${document.title} · EnergyX` : "EnergyX" };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const document = LEGAL_DOCUMENTS.find(item => item.id === doc);
  if (!document) notFound();
  const texts = document.sections.flatMap(section => section.blocks.flatMap(block => Array.isArray(block) ? block : [block]));
  return <main className={styles.layout}>
    <nav className={styles.nav} aria-label="Legal documents">
      {LEGAL_DOCUMENTS.map(item => <Link key={item.id} href={`/legal/${item.id}`} aria-current={item.id === document.id ? "page" : undefined}>{item.title}</Link>)}
    </nav>
    <article className={styles.doc}>
      <h1>{document.title}</h1>
      <p className={styles.summary}>{document.summary}</p>
      <p className={styles.meta}>Effective {COMPANY.effectiveDate || "[Effective date]"}</p>
      {hasBlanks(texts) ? <p className={styles.draft}>Draft: the highlighted company details still need filling in, and this document should be reviewed by a lawyer before customers rely on it.</p> : null}
      {document.sections.map(section => <section key={section.heading}>
        <h2>{section.heading}</h2>
        {section.blocks.map((block, index) => Array.isArray(block)
          ? <ul key={index}>{block.map(item => <li key={item}><LegalText text={item} /></li>)}</ul>
          : <p key={index}><LegalText text={block} /></p>)}
      </section>)}
    </article>
  </main>;
}
