"use client";
import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { useEnergyIqAccess } from "./energyiq-access";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { EnergyIcon } from "./icons";
import { guideContent, searchText } from "./user-guide-content";
import { GuideFigure } from "./user-guide-samples";
import { userGuideMessages } from "./user-guide-messages";
import styles from "./user-guide.module.css";

const SECTIONS = ["start", "pages", "tasks", "samples", "charts", "terms", "questions"] as const;
/** Fills `{name}` spots in a translated sentence with page elements such as links, keeping that language's word order. */
const withParts = (sentence: string, parts: Record<string, ReactNode>) => sentence.split(/(\{\w+\})/).map((piece, index) => {
  const name = /^\{(\w+)\}$/.exec(piece)?.[1];
  return <Fragment key={index}>{name && name in parts ? parts[name] : piece}</Fragment>;
});

/** Plain-language guide to EnergyX for facility managers and decision makers. */
export function UserGuide() {
  const [query, setQuery] = useState("");
  const t = useMessages(userGuideMessages);
  const { locale } = useEnergyIqLocale();
  const content = guideContent(locale);
  const isAdmin = useEnergyIqAccess().access?.role === "admin";
  // Searches the guide in the reader's language.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every(word => text.includes(word));
  const pages = content.pages.filter(page => matches(searchText(page.title, page.purpose, page.points, page.group)));
  const tasks = content.tasks.filter(task => matches(searchText(task.title, task.steps)));
  const charts = content.charts.filter(item => matches(searchText(item.term, item.meaning)));
  const terms = content.terms.filter(item => matches(searchText(item.term, item.meaning)));
  const questions = content.questions.filter(item => matches(searchText(item.question, item.answer)));
  const start = content.start.filter(step => matches(searchText(step.title, step.detail)));
  const samples = content.samples.filter(sample => matches(searchText(sample.title, sample.caption, sample.read)));
  const counts: Record<(typeof SECTIONS)[number], number> = { start: start.length, samples: samples.length, pages: pages.length, tasks: tasks.length, charts: charts.length, terms: terms.length, questions: questions.length };
  const nothing = Object.values(counts).every(count => count === 0);
  const groups = [...new Set(pages.map(page => page.group))];
  const searching = words.length > 0;

  return <div className={styles.guide}>
    <header className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className={styles.lead}>{t("lead")}</p>
      </div>
      <label className={styles.search}><EnergyIcon name="search" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchLabel")} /></label>
    </header>

    <nav className={styles.toc} aria-label={t("sections")}>{SECTIONS.map(id => <a key={id} href={`#${id}`} className={counts[id] ? undefined : styles.tocEmpty}>{t(`section.${id}`)}{searching && <span>{counts[id]}</span>}</a>)}</nav>

    {nothing && <p className={styles.noResults} role="status">{withParts(t("noResults"), { query, link: <Link href="/energyiq/reports">{t("noResultsLink")}</Link> })}</p>}

    {start.length > 0 && <section id="start" className={styles.section} aria-labelledby="guide-start">
      <h2 id="guide-start">{t("section.start")}</h2>
      <p className={styles.sectionLead}>{t("startLead")}</p>
      <ol className={styles.start}>{start.map(step => <li key={step.title}><strong>{step.title}</strong><span>{step.detail}</span></li>)}</ol>
    </section>}

    {pages.length > 0 && <section id="pages" className={styles.section} aria-labelledby="guide-pages">
      <h2 id="guide-pages">{t("section.pages")}</h2>
      {groups.map(group => <div key={group} className={styles.group}>
        <h3>{group}</h3>
        <div className={styles.cards}>{pages.filter(page => page.group === group).map(page => <article key={page.title} className={styles.card}>
          <header><span className={styles.icon} aria-hidden="true"><EnergyIcon name={page.icon} /></span><div><h4>{page.title}</h4><p>{page.purpose}</p></div></header>
          <ul>{page.points.map(point => <li key={point}>{point}</li>)}</ul>
          <Link href={page.href} className={styles.open}>{t("open", { title: page.title })} <EnergyIcon name="arrow" /></Link>
        </article>)}</div>
      </div>)}
    </section>}

    {tasks.length > 0 && <section id="tasks" className={styles.section} aria-labelledby="guide-tasks">
      <h2 id="guide-tasks">{t("section.tasks")}</h2>
      <div className={styles.tasks}>{tasks.map(task => <details key={task.title} className={styles.task} open={searching}>
        <summary><span>{task.title}</span>{task.adminOnly && <em className={isAdmin ? undefined : styles.locked}>{t("adminOnly")}</em>}</summary>
        <ol>{task.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </details>)}</div>
    </section>}

    {samples.length > 0 && <section id="samples" className={styles.section} aria-labelledby="guide-samples">
      <h2 id="guide-samples">{t("section.samples")}</h2>
      <p className={styles.sectionLead}>{t("samplesLead")}</p>
      <div className={styles.samples}>{samples.map(sample => <article key={sample.title} className={styles.sample}>
        <h3>{sample.title}</h3>
        <GuideFigure figure={sample.figure} />
        <p>{sample.caption}</p>
        <ul>{sample.read.map(line => <li key={line}>{line}</li>)}</ul>
      </article>)}</div>
    </section>}

    {charts.length > 0 && <section id="charts" className={styles.section} aria-labelledby="guide-charts">
      <h2 id="guide-charts">{t("section.charts")}</h2>
      <dl className={styles.terms}>{charts.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
    </section>}

    {terms.length > 0 && <section id="terms" className={styles.section} aria-labelledby="guide-terms">
      <h2 id="guide-terms">{t("section.terms")}</h2>
      <dl className={styles.terms}>{terms.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
    </section>}

    {questions.length > 0 && <section id="questions" className={styles.section} aria-labelledby="guide-questions">
      <h2 id="guide-questions">{t("section.questions")}</h2>
      <div className={styles.tasks}>{questions.map(item => <details key={item.question} className={styles.task} open={searching}>
        <summary><span>{item.question}</span></summary>
        <p>{item.answer}</p>
      </details>)}</div>
    </section>}

    <footer className={styles.footer}><EnergyIcon name="ask" /><p>{withParts(t("footer"), { link: <Link href="/energyiq/reports">{t("footerLink")}</Link> })}</p></footer>
  </div>;
}
