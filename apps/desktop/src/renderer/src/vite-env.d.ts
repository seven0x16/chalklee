/// <reference types="vite/client" />

import type React from "react";
import type { ChalkLeeDesktopApi } from "../../shared/contracts";

declare global {
  interface Window {
    chalkLee: ChalkLeeDesktopApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          value?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
