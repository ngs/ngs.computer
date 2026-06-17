import logoSvg from "./logo.svg?raw";

// The status link ships a plain "*" in the HTML so nothing flashes full-screen
// before CSS/JS arrive. Once the bundle runs, swap it for the inline SVG logo
// (inline so `fill: currentColor` can follow the light/dark theme).
export function mountLogo(): void {
  const link = document.querySelector(".status a");
  if (link) link.innerHTML = logoSvg;
}
