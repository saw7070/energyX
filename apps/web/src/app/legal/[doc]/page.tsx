import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_DOCUMENTS } from "../documents";
import { DOCUMENT_META, LegalIcon } from "../legal-icons";
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

const anchor = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

export default async function LegalDocumentPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const document = LEGAL_DOCUMENTS.find(item => item.id === doc);
  if (!document) notFound();
  const meta = DOCUMENT_META[document.id];
  const texts = document.sections.flatMap(section => section.blocks.flatMap(block => Array.isArray(block) ? block : [block]));
  const words = texts.join(" ").split(/\s+/u).length;
  const minutes = Math.max(1, Math.round(words / 220));
  return <main className={styles.docMain}>
    <section className={styles.docHero}>
      <div className={styles.docHeroInner}>
        <nav className={styles.crumbs} aria-label="Breadcrumb"><Link href="/legal">Trust center</Link><span aria-hidden="true">/</span><span>{document.title}</span></nav>
        <div className={styles.docTitle}>
          <span className={`${styles.cardIcon} ${meta ? styles[meta.tone] : ""}`}><LegalIcon name={meta?.icon ?? "document"} /></span>
          <div>
            <h1>{document.title}</h1>
            <p>{document.summary}</p>
          </div>
        </div>
        <ul className={styles.docMeta}>
          <li>Effective <LegalText text="{effectiveDate}" /></li>
          <li>{minutes} min read</li>
          <li>Singapore &amp; Malaysia</li>
        </ul>
      </div>
    </section>

    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Legal documents">
        <span className={styles.navTitle}>Documents</span>
        {LEGAL_DOCUMENTS.map(item => {
          const itemMeta = DOCUMENT_META[item.id];
          return <Link key={item.id} href={`/legal/${item.id}`} aria-current={item.id === document.id ? "page" : undefined}>
            <LegalIcon name={itemMeta?.icon ?? "document"} width={16} height={16} />{item.title}
          </Link>;
        })}
      </nav>
      <article className={styles.doc}>
        {hasBlanks(texts) ? <p className={styles.draft}><strong>Draft.</strong> The highlighted company details still need filling in, and this document should be reviewed by a lawyer before customers rely on it.</p> : null}
        <nav className={styles.toc} aria-label="On this page">
          <span>On this page</span>
          <ol>{document.sections.map(section => <li key={section.heading}><a href={`#${anchor(section.heading)}`}>{section.heading}</a></li>)}</ol>
        </nav>
        {document.sections.map(section => <section key={section.heading} id={anchor(section.heading)} className={styles.docSection}>
          <h2>{section.heading}</h2>
          {section.blocks.map((block, index) => Array.isArray(block)
            ? <ul key={index}>{block.map(item => <li key={item}><LegalText text={item} /></li>)}</ul>
            : <p key={index}><LegalText text={block} /></p>)}
        </section>)}
        <footer className={styles.docFoot}>
          <span>Questions about this document? <LegalText text="{contactEmail}" /></span>
          <Link href="/legal">Back to the Trust center <LegalIcon name="arrow" width={14} height={14} /></Link>
        </footer>
      </article>
    </div>
  </main>;
}
