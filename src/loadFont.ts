import { FONT_FAMILY } from "./config";

// Load Zen Old Mincho (weight 900) on demand for arbitrary text. The Google
// Fonts `text=` parameter returns a woff2 subset containing only the requested
// glyphs, so custom strings cost just a few KB. Declared after the bundled
// subset (font.css), so for these glyphs this face takes precedence.
//
// Note: the requested text is sent to Google Fonts in the request URL.
export async function loadRemoteFont(text: string): Promise<void> {
  const href =
    "https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@900&display=swap&text=" +
    encodeURIComponent(text);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  // Wait for the stylesheet so the @font-face is registered before we ask for it.
  await new Promise<void>((resolve) => {
    link.addEventListener(
      "load",
      () => {
        resolve();
      },
      { once: true },
    );
    link.addEventListener(
      "error",
      () => {
        resolve();
      },
      { once: true },
    );
    document.head.appendChild(link);
  });

  try {
    await document.fonts.load(`900 380px ${FONT_FAMILY}`, text);
    await document.fonts.ready;
  } catch {
    /* fall back to a system serif on failure */
  }
}
