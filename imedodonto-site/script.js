// =========================================================
// IMED Odonto — configurações
// Preencha o número do WhatsApp (somente dígitos, com DDI 55 e DDD 98).
// Ex.: "5598999999999"
// =========================================================
const CONFIG = {
  whatsapp: "5598991215974",
  whatsappLabel: "(98) 99121-5974",
  whatsappMessage: "Olá! Gostaria de agendar uma avaliação na IMED Odonto.",
  instagram: "https://www.instagram.com/imedodontoslz/",
};

document.documentElement.classList.remove("no-js");

// Links de WhatsApp (se o número ficar vazio, levam ao Instagram).
const waHref = CONFIG.whatsapp
  ? `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(CONFIG.whatsappMessage)}`
  : CONFIG.instagram;

document.querySelectorAll("[data-whatsapp]").forEach((el) => {
  el.href = waHref;
  el.target = "_blank";
  el.rel = "noopener";
});

if (CONFIG.whatsappLabel) {
  document.querySelectorAll("[data-phone-label]").forEach((el) => {
    el.textContent = CONFIG.whatsappLabel;
  });
}

// Header muda de estilo ao rolar
const header = document.querySelector(".header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Menu mobile
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("nav");

const setMenu = (open) => {
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  nav.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
};

toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
document.addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));

// Animações de entrada
const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const siblings = [...entry.target.parentElement.children].filter((c) => c.classList.contains("reveal"));
        entry.target.style.transitionDelay = `${Math.min(siblings.indexOf(entry.target), 6) * 80}ms`;
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("is-visible"));
}

document.getElementById("year").textContent = new Date().getFullYear();
