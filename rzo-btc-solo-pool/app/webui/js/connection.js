"use strict";

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-value]");

  if (!button) {
    return;
  }

  const value = button.dataset.copyValue;

  try {
    await navigator.clipboard.writeText(value);

    const originalText = button.textContent;
    button.textContent = "Kopiert ✓";

    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1600);
  } catch {
    button.textContent = "Kopieren fehlgeschlagen";
  }
});
