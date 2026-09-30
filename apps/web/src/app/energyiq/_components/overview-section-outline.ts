"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

import type { OverviewNavigationSection } from "./overview-section-navigation";

const OUTLINE_SELECTOR = "[data-overview-section], [data-overview-module]";
const ACTIVE_SECTION_TOP = 176;

export function readRenderedOverviewSections(root: HTMLElement): ReadonlyArray<OverviewNavigationSection> {
  const seen = new Set<string>();
  const sections: OverviewNavigationSection[] = [];
  const sectionByElement = new Map<HTMLElement, OverviewNavigationSection>();
  const childCounts = new Map<HTMLElement, number>();
  let topLevelCount = 0;

  for (const heading of root.querySelectorAll<HTMLElement>("[data-overview-heading-number]")) {
    heading.removeAttribute("data-overview-heading-number");
    if (heading.dataset.overviewNumberedAria === "true") {
      heading.removeAttribute("aria-label");
      delete heading.dataset.overviewNumberedAria;
    }
  }

  for (const element of root.querySelectorAll<HTMLElement>(OUTLINE_SELECTOR)) {
    const id = element.id.trim();
    const label = navigationLabel(element);
    if (!id || !label || seen.has(id)) continue;
    const parentElement = closestOutlineParent(element, root);
    const parent = parentElement ? sectionByElement.get(parentElement) : undefined;
    const depth = parent ? parent.depth + 1 : 0;
    let number: string;
    if (parent && parentElement) {
      const nextChild = (childCounts.get(parentElement) ?? 0) + 1;
      childCounts.set(parentElement, nextChild);
      number = `${parent.number}.${nextChild}`;
    } else {
      topLevelCount += 1;
      number = String(topLevelCount);
    }
    seen.add(id);
    const section = { id, label, number, depth };
    sections.push(section);
    sectionByElement.set(element, section);
    numberVisibleHeading(element, number, label);
  }

  return sections;
}

export function useOverviewSectionOutline({
  rootRef,
  fallbackSections,
  identityKey,
}: {
  rootRef: RefObject<HTMLElement | null>;
  fallbackSections: ReadonlyArray<OverviewNavigationSection>;
  identityKey: string;
}) {
  const [sections, setSections] = useState<ReadonlyArray<OverviewNavigationSection>>(fallbackSections);
  const [activeSectionId, setActiveSectionId] = useState(fallbackSections[0]?.id ?? "");

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      setSections((previous) => sameOutline(previous, fallbackSections) ? previous : fallbackSections);
      setActiveSectionId((previous) => previous === (fallbackSections[0]?.id ?? "")
        ? previous
        : (fallbackSections[0]?.id ?? ""));
      return;
    }

    let currentSections = readRenderedOverviewSections(root);
    let frameId: number | null = null;
    const scrollContainer = root.closest("main");

    const updateActiveSection = () => {
      const elements = currentSections
        .map((section) => targetWithinRoot(root, section.id))
        .filter((element): element is HTMLElement => Boolean(element));
      if (elements.length === 0) {
        setActiveSectionId("");
        return;
      }
      const passed = elements.filter((element) => element.getBoundingClientRect().top <= ACTIVE_SECTION_TOP);
      setActiveSectionId((passed.at(-1) ?? elements[0]).id);
    };

    const publishOutline = () => {
      const next = readRenderedOverviewSections(root);
      currentSections = next.length > 0 ? next : fallbackSections;
      setSections((previous) => sameOutline(previous, currentSections) ? previous : currentSections);
      updateActiveSection();
    };

    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        publishOutline();
      });
    };

    publishOutline();
    restoreFragmentTarget(root);

    scrollContainer?.addEventListener("scroll", updateActiveSection, { passive: true });
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleUpdate);
    mutationObserver?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "data-overview-section", "data-overview-module", "data-overview-navigation-label"],
    });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(root);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      scrollContainer?.removeEventListener("scroll", updateActiveSection);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [fallbackSections, identityKey, rootRef]);

  const selectSection = useCallback((sectionId: string) => {
    const root = rootRef.current;
    const target = root ? targetWithinRoot(root, sectionId) : null;
    if (!target) return;
    setActiveSectionId(sectionId);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#${encodeURIComponent(sectionId)}`,
    );
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start" });
  }, [rootRef]);

  return { sections, activeSectionId, selectSection };
}

function navigationLabel(element: HTMLElement): string {
  const explicitLabel = element.dataset.overviewNavigationLabel?.trim();
  if (explicitLabel) return explicitLabel;

  const labelledBy = element.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (label) return label;
  }

  return element.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6")?.textContent?.trim() ?? "";
}

function closestOutlineParent(element: HTMLElement, root: HTMLElement): HTMLElement | null {
  const parent = element.parentElement?.closest<HTMLElement>(OUTLINE_SELECTOR) ?? null;
  return parent && root.contains(parent) ? parent : null;
}

function numberVisibleHeading(element: HTMLElement, number: string, label: string): void {
  const heading = labelledElement(element)
    ?? element.querySelector<HTMLElement>("[data-overview-heading]")
    ?? element.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");
  if (!heading) return;
  heading.dataset.overviewHeadingNumber = number;
  if (!heading.hasAttribute("aria-label") || heading.dataset.overviewNumberedAria === "true") {
    heading.setAttribute("aria-label", `${number} ${label}`);
    heading.dataset.overviewNumberedAria = "true";
  }
}

function labelledElement(element: HTMLElement): HTMLElement | null {
  const labelledBy = element.getAttribute("aria-labelledby")?.trim().split(/\s+/)[0];
  if (!labelledBy) return null;
  const labelled = element.ownerDocument.getElementById(labelledBy);
  return labelled instanceof HTMLElement && element.contains(labelled) ? labelled : null;
}

function restoreFragmentTarget(root: HTMLElement): void {
  if (!window.location.hash) return;
  let targetId = window.location.hash.slice(1);
  try {
    targetId = decodeURIComponent(targetId);
  } catch {
    return;
  }
  const target = targetWithinRoot(root, targetId);
  if (!target) return;
  requestAnimationFrame(() => target.scrollIntoView?.({ block: "start" }));
}

function targetWithinRoot(root: HTMLElement, id: string): HTMLElement | null {
  const target = root.ownerDocument.getElementById(id);
  return target instanceof HTMLElement && root.contains(target) ? target : null;
}

function sameOutline(
  left: ReadonlyArray<OverviewNavigationSection>,
  right: ReadonlyArray<OverviewNavigationSection>,
): boolean {
  return left.length === right.length && left.every((section, index) => (
    section.id === right[index]?.id
      && section.label === right[index]?.label
      && section.number === right[index]?.number
      && section.depth === right[index]?.depth
  ));
}
