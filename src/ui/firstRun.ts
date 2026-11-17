/** Storage key carried over from the Codex preview on the same origin. */
const guideStorageKey = "bg02-studio-codex.first-run-guide.v1";
/** Nominal first-paint time for the logo screen. */
const splashDurationMs = 2000;

/** Keeps the logo visible briefly from first paint, while the app initializes in parallel. */
export function afterSplash(showApp: () => void): void {
  const firstPaint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
  const elapsed = firstPaint === undefined ? 0 : performance.now() - firstPaint;
  window.setTimeout(showApp, Math.max(0, splashDurationMs - elapsed));
}

/** Describes the current Home action to spotlight. */
export interface GuideHint {
  /** Actual button underneath the spotlight. */
  readonly target: HTMLButtonElement;
  /** Short title for the action. */
  readonly title: string;
  /** Instructions for the first visit. */
  readonly copy: string;
}

/** Controls the active spotlight dialog. */
export interface FirstRunGuide {
  /** Shows, updates, or suspends the guide as the current Home action changes. */
  sync(hint: GuideHint | null): void;
}

/** Shows a first-visit hint anchored to the current primary button on Home. */
export function createFirstRunGuide(dialog: HTMLDialogElement): FirstRunGuide {
  const tip = dialog.querySelector<HTMLElement>(".guide-tip")!;
  const spotlight = dialog.querySelector<HTMLElement>(".guide-spotlight")!;
  const arrow = dialog.querySelector<HTMLElement>(".guide-arrow")!;
  const title = dialog.querySelector<HTMLElement>("#first-run-title")!;
  const copy = dialog.querySelector<HTMLElement>("#first-run-copy")!;
  let target: HTMLButtonElement | null = null;
  let acknowledged = false;
  try {
    acknowledged = localStorage.getItem(guideStorageKey) === "1";
  } catch {
    // In-memory dismissal still works if browser storage is unavailable.
  }

  function place(): void {
    if (!dialog.open || !target) return;
    const viewport = window.visualViewport;
    const margin = 12;
    const padding = 5;
    const gap = 35;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const rect = target.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const highlightTop = rect.top - padding;
    const highlightBottom = rect.bottom + padding;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const above = highlightTop - viewportTop;
    const below = viewportBottom - highlightBottom;
    const pointUp = below >= height + gap + margin || below >= above;
    const desiredTop = pointUp ? highlightBottom + gap : highlightTop - gap - height;

    spotlight.style.left = `${rect.left - padding}px`;
    spotlight.style.top = `${highlightTop}px`;
    spotlight.style.width = `${rect.width + padding * 2}px`;
    spotlight.style.height = `${rect.height + padding * 2}px`;
    tip.style.left = `${Math.max(viewportLeft + margin, Math.min(center - width / 2, viewportRight - width - margin))}px`;
    tip.style.top = `${Math.max(viewportTop + margin, Math.min(desiredTop, viewportBottom - height - margin))}px`;
    arrow.style.left = `${center}px`;
    arrow.style.top = `${pointUp ? highlightBottom + 3 : highlightTop - 31}px`;
    arrow.classList.toggle("guide-arrow-down", !pointUp);
  }

  function dismiss(): void {
    acknowledged = true;
    try {
      localStorage.setItem(guideStorageKey, "1");
    } catch {
      // Keep the in-memory acknowledgment.
    }
    dialog.close();
    target?.focus({ preventScroll: true });
    observeTarget(null);
  }

  dialog.querySelector("#first-run-ok")!.addEventListener("click", dismiss);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, { passive: true });
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
  const observer = new ResizeObserver(place);
  observer.observe(tip);

  function observeTarget(next: HTMLButtonElement | null): void {
    if (target === next) return;
    if (target) observer.unobserve(target);
    target = next;
    if (target) observer.observe(target);
  }

  return {
    sync(hint: GuideHint | null): void {
      if (acknowledged) return;
      observeTarget(hint?.target ?? null);
      if (!hint) {
        if (dialog.open) dialog.close();
        return;
      }
      if (title.textContent !== hint.title) title.textContent = hint.title;
      if (copy.textContent !== hint.copy) copy.textContent = hint.copy;
      if (!dialog.open) dialog.showModal();
      place();
    },
  };
}
