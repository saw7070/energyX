"use client";
import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useEnergyIqAccess } from "./energyiq-access";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { EnergyIcon, type EnergyIconName } from "./icons";
import { guideContent, searchText } from "./user-guide-content";
import { GuideFigure } from "./user-guide-samples";
import { guideTour } from "./user-guide-tour";
import tourStyles from "./user-guide-tour.module.css";
import layout from "./user-guide-layout.module.css";
import { userGuideMessages } from "./user-guide-messages";
import styles from "./user-guide.module.css";

const SECTIONS = ["start", "pages", "tour", "tasks", "samples", "charts", "terms", "questions"] as const;
/** One icon per section, shown beside its heading and in the "On this page" list. */
const SECTION_ICONS: Record<(typeof SECTIONS)[number], EnergyIconName> = { start: "spark", pages: "map", tour: "monitor", tasks: "check", samples: "analysis", charts: "info", terms: "document", questions: "ask" };
/** Page cards take a colour from their group: main pages, facility, energy advisor. */
const GROUP_TONES = ["green", "blue", "violet"] as const;
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
  const tour = guideTour(locale).filter(page => matches(searchText(page.title, page.where, page.intro, page.parts.flatMap(part => [part.title, part.text]))));
  const counts: Record<(typeof SECTIONS)[number], number> = { start: start.length, samples: samples.length, pages: pages.length, tour: tour.length, tasks: tasks.length, charts: charts.length, terms: terms.length, questions: questions.length };
  const nothing = Object.values(counts).every(count => count === 0);
  const groups = [...new Set(pages.map(page => page.group))];
  const allGroups = [...new Set(content.pages.map(page => page.group))];
  const searching = words.length > 0;
  const tourCount = guideTour(locale).length;
  // The "On this page" list follows the reader: the section nearest the top of the screen is highlighted.
  const [active, setActive] = useState<string>("start");
  useEffect(() => {
    // The last section whose top has passed a line 30% down the screen; the page scrolls inside the app frame, so
    // scroll events are caught on the way down from any scrolling element.
    const update = () => {
      const line = window.innerHeight * 0.3;
      let current = "";
      for (const id of SECTIONS) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (!current || element.getBoundingClientRect().top <= line) current = id;
      }
      if (current) setActive(current);
    };
    update();
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => { document.removeEventListener("scroll", update, { capture: true }); window.removeEventListener("resize", update); };
  }, [query, locale]);
  const head = (id: (typeof SECTIONS)[number], lead?: string) => <div className={layout.sectionHead}>
    <span className={layout.sectionIcon} aria-hidden="true"><EnergyIcon name={SECTION_ICONS[id]} /></span>
    <div><h2 id={`guide-${id}`}>{t(`section.${id}`)}</h2>{lead && <p className={styles.sectionLead}>{lead}</p>}</div>
  </div>;

  return <div className={`${styles.guide} ${layout.guide}`}>
    <header className={`${styles.hero} ${layout.hero}`}>
      <div className={layout.heroText}>
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className={styles.lead}>{t("lead")}</p>
        <div className={layout.heroActions}>
          <a href="#start" className={layout.heroPrimary}>{t("heroStart")} <EnergyIcon name="arrow" /></a>
          <a href="#tour" className={layout.heroSecondary}><EnergyIcon name="monitor" />{t("heroTour")}</a>
        </div>
      </div>
      <div className={layout.heroSide}>
        <label className={styles.search}><EnergyIcon name="search" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchLabel")} /></label>
        <dl className={layout.heroStats}>
          <div><dt>{t("statPages")}</dt><dd>{tourCount}</dd></div>
          <div><dt>{t("statTasks")}</dt><dd>{content.tasks.length}</dd></div>
          <div><dt>{t("statLanguages")}</dt><dd>3</dd></div>
        </dl>
      </div>
    </header>

    <div className={layout.columns}>
    <aside className={layout.side}>
      <nav aria-label={t("onThisPage")}>
        <p className={layout.sideTitle}>{t("onThisPage")}</p>
        <ol className={layout.sideList}>{SECTIONS.map(id => <li key={id}>
          <a href={`#${id}`} aria-current={active === id ? "location" : undefined} className={counts[id] ? undefined : layout.sideEmpty}><EnergyIcon name={SECTION_ICONS[id]} /><span>{t(`section.${id}`)}</span>{searching && <b>{counts[id]}</b>}</a>
          {id === "tour" && active === "tour" && tour.length > 0 && <ol className={layout.sideSub}>{tour.map(page => <li key={page.id}><a href={`#tour-${page.id}`}>{page.title}</a></li>)}</ol>}
        </li>)}</ol>
      </nav>
      <div className={layout.sideHelp}>
        <span aria-hidden="true"><EnergyIcon name="ask" /></span>
        <strong>{t("helpTitle")}</strong>
        <p>{t("helpBody")}</p>
        <Link href="/energyiq/reports">{t("footerLink")} <EnergyIcon name="arrow" /></Link>
      </div>
    </aside>
    <div className={layout.content}>
    <nav className={`${styles.toc} ${layout.toc}`} aria-label={t("sections")}>{SECTIONS.map(id => <a key={id} href={`#${id}`} className={counts[id] ? undefined : styles.tocEmpty}>{t(`section.${id}`)}{searching && <span>{counts[id]}</span>}</a>)}</nav>

    {nothing && <p className={styles.noResults} role="status">{withParts(t("noResults"), { query, link: <Link href="/energyiq/reports">{t("noResultsLink")}</Link> })}</p>}

    {start.length > 0 && <section id="start" className={styles.section} aria-labelledby="guide-start">
      {head("start", t("startLead"))}
      <ol className={styles.start}>{start.map(step => <li key={step.title}><strong>{step.title}</strong><span>{step.detail}</span></li>)}</ol>
    </section>}

    {pages.length > 0 && <section id="pages" className={styles.section} aria-labelledby="guide-pages">
      {head("pages")}
      {groups.map(group => <div key={group} className={styles.group} data-tone={GROUP_TONES[allGroups.indexOf(group) % GROUP_TONES.length]}>
        <h3>{group}</h3>
        <div className={styles.cards}>{pages.filter(page => page.group === group).map(page => <article key={page.title} className={styles.card}>
          <header><span className={styles.icon} aria-hidden="true"><EnergyIcon name={page.icon} /></span><div><h4>{page.title}</h4><p>{page.purpose}</p></div></header>
          <ul>{page.points.map(point => <li key={point}>{point}</li>)}</ul>
          <Link href={page.href} className={styles.open}>{t("open", { title: page.title })} <EnergyIcon name="arrow" /></Link>
        </article>)}</div>
      </div>)}
    </section>}

    {tour.length > 0 && <section id="tour" className={styles.section} aria-labelledby="guide-tour">
      {head("tour", t("tourLead"))}
      {tour.length > 1 && <nav className={tourStyles.jump} aria-label={t("tourJump")}>{tour.map(page => <a key={page.id} href={`#tour-${page.id}`}>{page.title}</a>)}</nav>}
      <div className={tourStyles.pages}>{tour.map(page => <article key={page.id} id={`tour-${page.id}`} className={tourStyles.page} aria-labelledby={`tour-${page.id}-title`}>
        <header className={tourStyles.head}>
          <h3 id={`tour-${page.id}-title`}>{page.title}</h3>
          <p className={tourStyles.where}>{t("tourWhere", { where: page.where })}</p>
          <p>{page.intro}</p>
        </header>
        <div className={tourStyles.body}>
          {/* The picture opens full size in a new tab; the numbers on it match the list beside it. */}
          <a className={tourStyles.shot} href={page.image} target="_blank" rel="noreferrer" style={{ aspectRatio: `${page.shot.width} / ${page.shot.height}` }}>
            <img src={page.image} alt={t("tourAlt", { title: page.title })} width={page.shot.width} height={page.shot.height} loading="lazy" decoding="async" />
            {page.shot.markers.map(([x, y], index) => <span key={index} className={tourStyles.marker} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">{index + 1}</span>)}
          </a>
          <ol className={tourStyles.parts}>{page.parts.map((part, index) => <li key={part.title}><span className={tourStyles.number} aria-hidden="true">{index + 1}</span><div><strong>{part.title}</strong><p>{part.text}</p></div></li>)}</ol>
        </div>
        {page.href && <Link href={page.href} className={styles.open}>{t("open", { title: page.title })} <EnergyIcon name="arrow" /></Link>}
      </article>)}</div>
    </section>}

    {tasks.length > 0 && <section id="tasks" className={styles.section} aria-labelledby="guide-tasks">
      {head("tasks")}
      <div className={styles.tasks}>{tasks.map(task => <details key={task.title} className={styles.task} open={searching}>
        <summary><span>{task.title}</span>{task.adminOnly && <em className={isAdmin ? undefined : styles.locked}>{t("adminOnly")}</em>}</summary>
        <ol>{task.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </details>)}</div>
    </section>}

    {samples.length > 0 && <section id="samples" className={styles.section} aria-labelledby="guide-samples">
      {head("samples", t("samplesLead"))}
      <div className={styles.samples}>{samples.map(sample => <article key={sample.title} className={styles.sample}>
        <h3>{sample.title}</h3>
        <GuideFigure figure={sample.figure} />
        <p>{sample.caption}</p>
        <ul>{sample.read.map(line => <li key={line}>{line}</li>)}</ul>
      </article>)}</div>
    </section>}

    {charts.length > 0 && <section id="charts" className={styles.section} aria-labelledby="guide-charts">
      {head("charts")}
      <dl className={styles.terms}>{charts.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
    </section>}

    {terms.length > 0 && <section id="terms" className={styles.section} aria-labelledby="guide-terms">
      {head("terms")}
      <dl className={styles.terms}>{terms.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
    </section>}

    {questions.length > 0 && <section id="questions" className={styles.section} aria-labelledby="guide-questions">
      {head("questions")}
      <div className={styles.tasks}>{questions.map(item => <details key={item.question} className={styles.task} open={searching}>
        <summary><span>{item.question}</span></summary>
        <p>{item.answer}</p>
      </details>)}</div>
    </section>}

    <footer className={styles.footer}><EnergyIcon name="ask" /><p>{withParts(t("footer"), { link: <Link href="/energyiq/reports">{t("footerLink")}</Link> })}</p></footer>
    </div>
    </div>
  </div>;
}
