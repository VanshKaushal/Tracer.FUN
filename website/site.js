document.getElementById("year").textContent = String(new Date().getFullYear());
document.querySelectorAll(".mobile-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelector(".mobile-nav").open = false;
    const section = document.querySelector(link.hash);
    section.tabIndex = -1;
    section.focus({ preventScroll: true });
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const menu = document.querySelector(".mobile-nav");
  if (menu.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});
