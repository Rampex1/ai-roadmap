// Any island can ask the lesson's tutor drawer to open, prefilled with context.
export type AskDetail = { question?: string; error?: string; prompt: string };
export const ASK_EVENT = 'air:ask-tutor';
export function askTutor(detail: AskDetail) {
  window.dispatchEvent(new CustomEvent<AskDetail>(ASK_EVENT, { detail }));
}
