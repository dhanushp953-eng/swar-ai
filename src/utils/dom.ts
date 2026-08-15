/** True when an event's target is an element the user can type into, so
 *  computer-keyboard piano shortcuts should be ignored there. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable === true) return true;
  const contentEditable = target.getAttribute("contenteditable");
  return contentEditable !== null && contentEditable !== "false";
}
