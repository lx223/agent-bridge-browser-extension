interface HeldFrame {
  marker: Comment;
  frame: Element;
}

interface FrameHolder {
  agentBrowserBridgeHeldFrames?: HeldFrame[];
}

export function setAsideOtherExtensionFramesInPage(ownOrigin: string): number {
  const holder = globalThis as FrameHolder;
  const held = (holder.agentBrowserBridgeHeldFrames ??= []);
  const urlOf = (element: Element) => {
    if (element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement || element instanceof HTMLEmbedElement) return element.src;
    if (element instanceof HTMLObjectElement) return element.data;
    return '';
  };
  const isOtherExtensionUrl = (url: string) => url.startsWith('chrome-extension://') && !url.startsWith(ownOrigin);
  const shadowRootOf = (element: Element) => {
    if (!(element instanceof HTMLElement)) return null;
    return chrome.dom?.openOrClosedShadowRoot?.(element) ?? element.shadowRoot;
  };
  const found: Element[] = [];
  const visit = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll('*')) {
      if (isOtherExtensionUrl(urlOf(element))) found.push(element);
      const shadow = shadowRootOf(element);
      if (shadow) visit(shadow);
    }
  };
  visit(document);
  for (const frame of found) {
    const marker = document.createComment('agent-browser-bridge');
    frame.replaceWith(marker);
    held.push({ marker, frame });
  }
  return found.length;
}

export function putBackOtherExtensionFramesInPage(): number {
  const holder = globalThis as FrameHolder;
  const held = holder.agentBrowserBridgeHeldFrames ?? [];
  holder.agentBrowserBridgeHeldFrames = [];
  for (const { marker, frame } of held) marker.replaceWith(frame);
  return held.length;
}
