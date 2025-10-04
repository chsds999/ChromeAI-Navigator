chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.output) {
    alert(msg.output); // In production, send to popup UI or page overlay
  }
});
