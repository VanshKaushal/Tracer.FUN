const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
document.querySelectorAll(".mobile-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    link.closest(".mobile-nav").open = false;
    if (link.pathname !== location.pathname || !link.hash) return;
    const section = document.getElementById(
      decodeURIComponent(link.hash.slice(1)),
    );
    if (section) {
      section.tabIndex = -1;
      section.focus({ preventScroll: true });
    }
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const menu = document.querySelector(".mobile-nav");
  if (menu?.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});
