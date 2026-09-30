if (sessionStorage.getItem("e2e-disable-protected-frame") !== "1") {
  const frame = document.createElement("iframe");
  frame.dataset.e2eProtectedExtensionFrame = "";
  frame.hidden = true;
  frame.src = chrome.runtime.getURL("frame.html");
  document.documentElement.append(frame);
}
