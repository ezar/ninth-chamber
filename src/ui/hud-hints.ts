/**
 * Which of Nora's hints are tutorial tips (how to play), which the player can
 * turn off in Options → Accessibility, and which are her remarks about a
 * chamber (story and puzzles), which always show. Tips have a one-part key
 * (`hint.grab`); a chamber's remarks carry its name (`hint.roots.start`).
 */
export const isTutorialHint = (key: string): boolean => /^hint\.[A-Za-z]+$/.test(key);
