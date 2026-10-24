---
name: localization
description: Choosing or reviewing the translation of a UI string. Use when adding a non-English locale, deciding a term for a developer-facing concept, auditing whether a locale is ready to ship, or judging whether an English string should stay English.
---

# Localization

This covers the *content* of a translation. The structural rules — keys, `plural`, `tDynamic`, never editing English source — live in each package's `AGENTS.md` under `## Localization`. Do not restate them here.

## A locale is ready when all four hold

1. Every recurring concept maps to exactly one term. **Recurring** means the English source appears in 2 or more keys — count it, do not estimate.
2. Every value that still equals its English source is classified as one of: product name, provider or tool name, URL, code token, keyboard legend, acronym, asset name, established borrowing. Anything unclassified is a leftover and must be translated.
3. Two named corpora are recorded in the review notes, at least one of them a maintained UI localization (Firefox, KDE, or VS Code).
4. Terms a native speaker could contest are listed with the alternative that was rejected, so review spends its attention there.

If a locale cannot meet all four, ship it as English fallback instead of half-translating it.

## Where to settle a term

Check in this order and stop at the first that settles it:

1. The same concept already translated in the same grammatical role inside this app. Consistency beats freshness.
2. A maintained localization of a comparable developer tool — Firefox, KDE, VS Code. Use two independent corpora when they disagree, or when the term is load-bearing.
3. Unicode CLDR for plural rules and locale identifiers. Not for terminology.
4. The language authority for the locale: RAE/Fundéu, FranceTerme, Duden, TDK, Kotus, Språkrådet, PWN, the Russian and Arabic language academies, the Ukrainian Orthography, Taiwan MOE dictionaries, the Royal Society of Thailand.

Never settle a term from model knowledge alone. Model output is the median of its training data, and the median term is the one that reads like a translation.

## Borrow or translate

Keep the English form when it is a product or provider name, a URL, a code identifier, a keyboard legend, an acronym, or the word the target language's developer community already uses. Translate when the English word is an ordinary noun doing ordinary work.

Check terse labels in the same grammatical role before deciding: session, prompt, agent, model, fork, shell, terminal, workspace, worktree. A glossary hit is evidence, not permission to translate word by word.

## Composing copy

Prefer one complete phrase over assembled fragments. Placeholders carry only irreducible values — names, paths, counts — never grammar. When one UI concept needs several coordinated keys, add a single language-context operation that owns the composition, and call that.

When the current API cannot express a translation, deepen the shared i18n module so one typed call owns locale selection, plural resolution, fallback, and interpolation. Do not leak that machinery into product code.
