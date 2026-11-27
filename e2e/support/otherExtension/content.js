const frameUrl = chrome.runtime.getURL('frame.html');

const plainFrame = document.createElement('iframe');
plainFrame.id = 'other-extension-frame';
plainFrame.src = frameUrl;
document.body.append(plainFrame);

const host = document.createElement('other-extension-menu');
const shadow = host.attachShadow({ mode: 'closed' });
const shadowFrame = document.createElement('iframe');
shadowFrame.src = frameUrl;
shadow.append(shadowFrame);
document.body.append(host);
