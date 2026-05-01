// MV3 service worker. Opens the Side Panel when the toolbar action is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("ankify: failed to set panel behavior", err));
});

// Re-apply on startup in case the install hook missed it (e.g. after browser update).
chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("ankify: failed to set panel behavior", err));
});
