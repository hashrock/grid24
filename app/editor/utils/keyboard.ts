export const isTypingTarget = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || !!t?.isContentEditable;
};
