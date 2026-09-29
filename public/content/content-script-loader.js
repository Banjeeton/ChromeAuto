void import(chrome.runtime.getURL("content/content-script.js")).catch(
  (error) => {
    console.error("Unable to initialize the automation recorder.", error);
  }
);
