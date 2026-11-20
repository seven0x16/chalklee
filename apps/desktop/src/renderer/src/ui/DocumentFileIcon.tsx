import { documentKindFamily, isHtmlKind, isLatexKind, isMarkdownKind } from "../../../shared/document/kinds";
import { memo, useId } from "react";
import type { DocumentKind } from "../../../shared/contracts";

const viewBox = "8 31 109 109";
const fileIconClass = (kind: DocumentKind) => `document-file-icon ${documentKindFamily(kind)}-file-icon`;
const spriteKinds: readonly DocumentKind[] = ["chalklee", "pdf", "doc", "docx", "tex", "markdown", "html"];

/** File types share the C-shaped frame from ../assets/logo.svg. */
export function DocumentFileIcon({ kind, size = 16 }: { kind: DocumentKind; size?: number }) {
  const id = useId();
  return <svg className={fileIconClass(kind)} width={size} height={size} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">
    <DocumentFileGlyph kind={kind} id={id} />
  </svg>;
}

/** Large lists reuse the same geometry and gradient definitions for each file kind. */
export const DocumentFileIconSprite = memo(function DocumentFileIconSprite({ prefix }: { prefix: string }) {
  return <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true" focusable="false"><defs>
    {spriteKinds.map(kind => {
      const id = `${prefix}-${kind}`;
      return <g key={kind} id={id} className={fileIconClass(kind)} fill="none"><DocumentFileGlyph kind={kind} id={id} /></g>;
    })}
  </defs></svg>;
});

const spriteHref = (kind: DocumentKind, prefix: string) => `#${prefix}-${documentKindFamily(kind)}`;

export function documentFileIconReference(kind: DocumentKind, prefix: string, defer: boolean) {
  const href = spriteHref(kind, prefix);
  return <svg className={fileIconClass(kind)} width={16} height={16} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">
    <use href={defer ? undefined : href} data-tree-icon={defer ? href : undefined} />
  </svg>;
}

function DocumentFileGlyph({ kind, id }: { kind: DocumentKind; id: string }) {
  const main = `${id}-main`;
  const fold = `${id}-fold`;
  const accent = "var(--cm-file-icon-accent, var(--cm-theme-accent))";
  const strong = "var(--cm-file-icon-strong, var(--cm-theme-accent-strong))";
  // Source-file frames curl up to the center of the ChalkLee check badge.
  const frameEnd = kind === "chalklee"
    ? "C 84.5 129.5 88.8 126.4 91.4 121.6"
    : "C 87.9 129.5 93.5 123.8 95.5 115.5";

  return (
    <>
      <defs>
        <linearGradient id={main} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={strong} />
          <stop offset="1" stopColor={accent} />
        </linearGradient>
        <linearGradient id={fold} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={accent} stopOpacity=".65" />
          <stop offset="1" stopColor={strong} />
        </linearGradient>
      </defs>
      <path
        d={`M 79 41.5 L 37 41.5 C 28.4 41.5 21.5 48.4 21.5 57 L 21.5 113.5 C 21.5 122.3 28.7 129.5 37.5 129.5 L 78.5 129.5 ${frameEnd}`}
        stroke={`url(#${main})`} strokeWidth="13" strokeLinecap="butt" strokeLinejoin="round"
      />
      <path
        d="M78 35H80.2a2.5 2.5 0 0 1 1.77.73l22.2 22.2c1.9 1.9.6 5.1-2.1 5.1H89.4c-6.4 0-11.4-5.1-11.4-11.4Z"
        fill={`url(#${fold})`}
      />
      {kind === "chalklee" ? (
        <>
          <g fill={`url(#${main})`}>
            <circle cx="42" cy="70.5" r="6.9" />
            <circle cx="42" cy="87" r="6.9" />
            <circle cx="42" cy="104" r="6.9" />
          </g>
          <g fill="#fff">
            <path d="M43.4 72.95H40.6L40.13 74.3H38.64L41.18 67.22H42.83L45.37 74.3H43.87ZM43.02 71.81 42 68.86 40.98 71.81Z" />
            <path d="M44.82 88.89Q44.82 89.45 44.54 89.88Q44.27 90.31 43.74 90.55Q43.21 90.8 42.49 90.8H39.45V83.73H42.36Q43.08 83.73 43.6 83.96Q44.12 84.19 44.39 84.61Q44.66 85.02 44.66 85.55Q44.66 86.17 44.32 86.59Q44 87 43.45 87.17Q44.05 87.29 44.44 87.77Q44.82 88.25 44.82 88.89ZM40.86 86.64H42.16Q42.67 86.64 42.93 86.41Q43.21 86.19 43.21 85.77Q43.21 85.34 42.93 85.1Q42.67 84.87 42.16 84.87H40.86ZM43.38 88.71Q43.38 88.25 43.08 88Q42.77 87.74 42.25 87.74H40.86V89.64H42.29Q42.8 89.64 43.09 89.4Q43.38 89.15 43.38 88.71Z" />
            <path d="M42.05 100.64Q43.23 100.64 44.13 101.25Q45.01 101.85 45.37 102.93H43.74Q43.49 102.42 43.06 102.17Q42.62 101.92 42.05 101.92Q41.42 101.92 40.94 102.21Q40.46 102.49 40.19 103.02Q39.93 103.54 39.93 104.25Q39.93 104.95 40.19 105.48Q40.46 106.01 40.94 106.3Q41.42 106.59 42.05 106.59Q42.62 106.59 43.06 106.33Q43.49 106.07 43.74 105.56H45.37Q45.01 106.66 44.13 107.25Q43.24 107.85 42.05 107.85Q41.03 107.85 40.23 107.39Q39.41 106.93 38.94 106.12Q38.47 105.3 38.47 104.25Q38.47 103.21 38.94 102.39Q39.41 101.56 40.23 101.1Q41.03 100.64 42.05 100.64Z" />
          </g>
          <g stroke={accent} strokeOpacity=".65" strokeWidth="5" strokeLinecap="round">
            <path d="M56.4 70.5H88.5" />
            <path d="M56.4 87.5H88.5" />
            <path d="M56.4 104H78.5" />
          </g>
          <circle cx="95.5" cy="115.5" r="14.4" fill="var(--cm-ui-surface)" />
          <circle cx="95.5" cy="115.5" r="12.4" fill={`url(#${main})`} />
          <path d="M89.4 115.2l4.4 4.5 8.1-9" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : kind === "pdf" ? (
        <path
          d="M47 111C56 95 65 74 65 66C65 56 56 57 58 69C62 87 77 104 91 105C105 106 104 96 93 96C78 96 50 103 40 111C30 121 39 126 47 111Z"
          transform="translate(65 90) scale(.88) translate(-65 -90)"
          stroke={`url(#${main})`} strokeWidth="6.8" strokeLinecap="round" strokeLinejoin="round"
        />
      ) : isMarkdownKind(kind) ? (
        <path
          d="M36 109V74H44L53 87L62 74H70V109H62V87L53 100L44 87V109ZM82 74H89V94H96L85.5 106L75 94H82Z"
          fill={`url(#${main})`}
        />
      ) : isLatexKind(kind) ? (
        <path
          d="M36 76H62M49 76V110M70 80L92 108M92 80L70 108"
          stroke={`url(#${main})`} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
        />
      ) : isHtmlKind(kind) ? (
        <path
          d="M51 77L38 92L51 107M79 77L92 92L79 107M69.5 73L60.5 111"
          stroke={`url(#${main})`} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
        />
      ) : (
        <path
          d="M36 70H46L52 99L61 72H69L78 99L84 70H94L84 113H74L65 87L56 113H46Z"
          fill={`url(#${main})`}
        />
      )}
    </>
  );
}
