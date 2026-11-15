/**
 * @module ui/icons
 * Zero-dependency inline SVG vector icon builder using `document.createElementNS`
 * cleanly without HTML string parsing (`innerHTML`).
 */

/** Namespace URI for W3C Scalable Vector Graphics elements. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** Supported vector icon names rendered across Studio toolbars and status chips. */
export type StudioIconName =
  | "badge"
  | "bluetooth"
  | "refresh"
  | "power"
  | "plus"
  | "edit"
  | "trash"
  | "photo"
  | "cover"
  | "contain"
  | "rotateCw"
  | "rotateCcw"
  | "text"
  | "reset"
  | "send"
  | "download"
  | "sliders"
  | "check"
  | "close"
  | "copy"
  | "battery"
  | "camera"
  | "chevronRight"
  | "arrowLeft"
  | "unlink"
  | "info";

/** Geometry instruction representing either a `<path>`, `<circle>`, or `<rect>` primitive. */
export type IconShapeNode =
  | {
      /** SVG `<path>` element primitive. */
      readonly tag: "path";
      /** SVG `d` path geometry command string. */
      readonly d: string;
    }
  | {
      /** SVG `<circle>` element primitive. */
      readonly tag: "circle";
      /** Center X coordinate inside 24×24 viewBox. */
      readonly cx: number;
      /** Center Y coordinate inside 24×24 viewBox. */
      readonly cy: number;
      /** Circle radius inside 24×24 viewBox. */
      readonly r: number;
    }
  | {
      /** SVG `<rect>` element primitive. */
      readonly tag: "rect";
      /** Left X coordinate inside 24×24 viewBox. */
      readonly x: number;
      /** Top Y coordinate inside 24×24 viewBox. */
      readonly y: number;
      /** Rectangle width inside 24×24 viewBox. */
      readonly width: number;
      /** Rectangle height inside 24×24 viewBox. */
      readonly height: number;
      /** Corner radius inside 24×24 viewBox. */
      readonly rx: number;
    };

/** Lookup registry mapping each {@link StudioIconName} to clean 24×24 stroke primitives. */
export const ICON_PATHS: Readonly<Record<StudioIconName, ReadonlyArray<IconShapeNode>>> = {
  badge: [
    { tag: "circle", cx: 12, cy: 12, r: 9 },
    { tag: "circle", cx: 12, cy: 12, r: 5 },
  ],
  bluetooth: [{ tag: "path", d: "M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11" }],
  refresh: [
    { tag: "path", d: "M21 12a9 9 0 0 1-15.4 6.36L3 16" },
    { tag: "path", d: "M3 12a9 9 0 0 1 15.4-6.36L21 8" },
    { tag: "path", d: "M21 3v5h-5M3 21v-5h5" },
  ],
  power: [
    { tag: "path", d: "M18.36 6.64a9 9 0 1 1-12.73 0" },
    { tag: "path", d: "M12 2v10" },
  ],
  plus: [{ tag: "path", d: "M12 5v14M5 12h14" }],
  edit: [
    { tag: "path", d: "M12 20h9" },
    { tag: "path", d: "M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" },
  ],
  trash: [
    { tag: "path", d: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" },
    { tag: "path", d: "M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" },
  ],
  photo: [
    { tag: "rect", x: 3, y: 3, width: 18, height: 18, rx: 3 },
    { tag: "circle", cx: 8.5, cy: 8.5, r: 1.5 },
    { tag: "path", d: "M21 15l-5-5L5 21" },
  ],
  cover: [
    { tag: "path", d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" },
  ],
  contain: [
    { tag: "path", d: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" },
  ],
  rotateCw: [
    { tag: "path", d: "M21 12a9 9 0 1 1-3-6.7L21 8" },
    { tag: "path", d: "M21 3v5h-5" },
  ],
  rotateCcw: [
    { tag: "path", d: "M3 12a9 9 0 1 0 3-6.7L3 8" },
    { tag: "path", d: "M3 3v5h5" },
  ],
  text: [{ tag: "path", d: "M4 7V4h16v3M9 20h6M12 4v16" }],
  reset: [
    { tag: "path", d: "M3 12a9 9 0 1 0 3.3-6.95L3 8" },
    { tag: "path", d: "M3 3v5h5" },
  ],
  send: [
    { tag: "path", d: "M12 19V5M5 12l7-7 7 7" },
  ],
  download: [
    { tag: "path", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" },
  ],
  sliders: [
    { tag: "path", d: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" },
  ],
  check: [{ tag: "path", d: "M20 6L9 17l-5-5" }],
  close: [{ tag: "path", d: "M18 6L6 18M6 6l12 12" }],
  copy: [
    { tag: "rect", x: 9, y: 9, width: 13, height: 13, rx: 2 },
    { tag: "path", d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" },
  ],
  battery: [
    { tag: "rect", x: 2, y: 7, width: 18, height: 10, rx: 2 },
    { tag: "path", d: "M22 10v4" },
  ],
  camera: [
    { tag: "path", d: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" },
    { tag: "circle", cx: 12, cy: 13, r: 4 },
  ],
  chevronRight: [{ tag: "path", d: "M9 18l6-6-6-6" }],
  arrowLeft: [{ tag: "path", d: "M15 18l-6-6 6-6" }],
  unlink: [
    { tag: "path", d: "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" },
    { tag: "path", d: "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" },
    { tag: "path", d: "M8 2v3M2 8h3M16 19v3M19 16h3" },
  ],
  info: [
    { tag: "circle", cx: 12, cy: 12, r: 10 },
    { tag: "path", d: "M12 16v-4M12 8h.01" },
  ],
};

/**
 * Constructs a decorative `aria-hidden="true"` inline `<svg>` icon node safely via DOM APIs.
 *
 * @param name - Registered vector icon identifier.
 * @param sizePx - Rendered icon square dimensions in CSS pixels (default `16`).
 * @returns Styled `SVGSVGElement` ready for insertion inside buttons or pills.
 */
export function createStudioIcon(name: StudioIconName, sizePx = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(sizePx));
  svg.setAttribute("height", String(sizePx));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "studio-icon");

  const shapes = ICON_PATHS[name];
  for (const shape of shapes) {
    if (shape.tag === "path") {
      const el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", shape.d);
      svg.appendChild(el);
    } else if (shape.tag === "circle") {
      const el = document.createElementNS(SVG_NS, "circle");
      el.setAttribute("cx", String(shape.cx));
      el.setAttribute("cy", String(shape.cy));
      el.setAttribute("r", String(shape.r));
      svg.appendChild(el);
    } else {
      const el = document.createElementNS(SVG_NS, "rect");
      el.setAttribute("x", String(shape.x));
      el.setAttribute("y", String(shape.y));
      el.setAttribute("width", String(shape.width));
      el.setAttribute("height", String(shape.height));
      el.setAttribute("rx", String(shape.rx));
      svg.appendChild(el);
    }
  }

  return svg;
}
