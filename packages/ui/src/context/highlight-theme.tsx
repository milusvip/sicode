import type { Theme } from "@pierre/highlights"

// A Highlights palette: each value names an app CSS variable without its `--`, so code follows the active app theme.
// Token types are grouped as in Pierre's own `pierre-dark` theme (for example, properties share the variable colour
// and all punctuation is one muted colour); each group uses the app syntax role with the same meaning.
// Token names fall back to their parent scope, so `keyword.control` uses `keyword`.
export const OpenCodeTheme = {
  name: "OpenCode",
  appearance: "dark",
  cssVariables: { prefix: "--" },
  style: {
    // SiCode: was color-background-stronger / text-base — those OC-2 vars only follow the OS
    // preference, so the code card went black in a light app (and white in a dark one) whenever
    // the OS and app themes disagreed. The v2 tokens follow data-color-scheme.
    "editor.background": "v2-background-bg-layer-02",
    "editor.foreground": "v2-text-text-base",
    created: "syntax-diff-add",
    deleted: "syntax-diff-delete",
    modified: "syntax-diff-unknown",
    syntax: {
      attribute: "syntax-property",
      background: "v2-background-bg-layer-02",
      boolean: "syntax-constant",
      comment: "syntax-comment",
      constant: "syntax-constant",
      constructor: "syntax-type",
      "diff.minus": "syntax-diff-delete",
      "diff.plus": "syntax-diff-add",
      embedded: "v2-text-text-base",
      emphasis: "v2-text-text-base",
      enum: "syntax-type",
      foreground: "v2-text-text-base",
      function: "syntax-primitive",
      hint: "syntax-comment",
      keyword: "syntax-keyword",
      "keyword.operator": "syntax-operator",
      label: "syntax-constant",
      link_text: "syntax-info",
      link_uri: "syntax-keyword",
      namespace: "syntax-constant",
      number: "syntax-constant",
      operator: "syntax-operator",
      predictive: { color: "syntax-comment", font_style: "italic" },
      preproc: "syntax-keyword",
      primary: "syntax-info",
      property: "syntax-variable",
      punctuation: "syntax-punctuation",
      "punctuation.special": "syntax-keyword",
      selector: "syntax-keyword",
      "selector.class": "syntax-property",
      "selector.id": "syntax-primitive",
      "selector.pseudo": "syntax-operator",
      string: "syntax-string",
      "string.escape": "syntax-constant",
      "string.regex": "syntax-regexp",
      "string.special": "syntax-constant",
      tag: "syntax-keyword",
      "tag.component.jsx": "syntax-type",
      text: "v2-text-text-base",
      "text.literal": "syntax-string",
      title: { color: "syntax-keyword", font_weight: 700 },
      type: "syntax-type",
      variable: "syntax-variable",
      "variable.parameter": "v2-text-text-base",
      "variable.special": "syntax-constant",
      variant: "syntax-constant",
    },
  },
} satisfies Theme
