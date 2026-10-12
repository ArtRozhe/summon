// How the New Tab page gets keyboard focus. Chrome gives a new tab's focus to the address bar; a tab
// the extension creates with chrome.tabs.create gets page focus instead. So the background worker
// swaps every new New Tab for a tab it creates itself with the same page.

/** Query parameter that marks the tab the worker created (the one with page focus). */
export const REPLACED = 'replaced';

/** A tab Chrome opened on the New Tab page (⌘T, a new window), as opposed to one we created. */
export function isFreshNewTab(tab: chrome.tabs.Tab): boolean {
  const url = tab.pendingUrl || tab.url || '';
  return url === 'chrome://newtab/' || url === chrome.runtime.getURL('newtab.html');
}
