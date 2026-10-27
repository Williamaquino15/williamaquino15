// ===== CONFIGURAÇÃO — edite aqui =====
const CONFIG = {
  // Número do WhatsApp com DDI + DDD, só dígitos (ex.: 5519999999999)
  whatsapp: "5519991545887",
  whatsappMessage: "Oii vim do Instagram!\nQuero agendar uma consulta",
  instagram: "https://www.instagram.com/drramonclaros/",
};

const waLink = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(CONFIG.whatsappMessage)}`;

document.querySelectorAll(".js-whatsapp").forEach((a) => {
  a.href = waLink;
  a.target = "_blank";
  a.rel = "noopener";
});

document.querySelectorAll(".js-instagram").forEach((a) => {
  a.href = CONFIG.instagram;
  a.target = "_blank";
  a.rel = "noopener";
});

document.getElementById("year").textContent = new Date().getFullYear();

// Animação de entrada ao rolar a página
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);
document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// Abre apenas uma pergunta do FAQ por vez
document.querySelectorAll(".faq details").forEach((d) => {
  d.addEventListener("toggle", () => {
    if (d.open) document.querySelectorAll(".faq details").forEach((o) => o !== d && (o.open = false));
  });
});

// Carrossel de resultados: avança sozinho, setas, bolinhas e pausa ao interagir
(function () {
  const slider = document.querySelector(".slider");
  if (!slider) return;
  const carousel = slider.querySelector(".carousel");
  const slides = [...carousel.querySelectorAll(".result")];
  const dotsWrap = document.querySelector(".slider__dots");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const INTERVAL = 2000;
  let timer = null;
  let hovering = false;

  const step = () => slides[1].offsetLeft - slides[0].offsetLeft;
  const maxScroll = () => carousel.scrollWidth - carousel.clientWidth;
  const current = () => Math.round(carousel.scrollLeft / step());

  const dots = slides.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.addEventListener("click", () => { goTo(i); restart(); });
    dotsWrap.appendChild(b);
    return b;
  });

  function goTo(i) {
    const last = Math.ceil(maxScroll() / step());
    if (i > last) i = 0;
    if (i < 0) i = last;
    carousel.scrollTo({ left: Math.min(i * step(), maxScroll()) });
  }

  function updateDots() {
    const atEnd = carousel.scrollLeft >= maxScroll() - 4;
    const active = atEnd ? slides.length - 1 : current();
    dots.forEach((d, i) => d.classList.toggle("is-active", i === active));
  }

  const next = () => (carousel.scrollLeft >= maxScroll() - 4 ? goTo(0) : goTo(current() + 1));
  const prev = () => goTo(current() - 1);

  function start() { if (!reduceMotion && !hovering && !timer) timer = setInterval(next, INTERVAL); }
  function stop() { clearInterval(timer); timer = null; }
  function restart() { stop(); start(); }

  slider.querySelector(".slider__btn--next").addEventListener("click", () => { next(); restart(); });
  slider.querySelector(".slider__btn--prev").addEventListener("click", () => { prev(); restart(); });
  carousel.addEventListener("scroll", updateDots, { passive: true });
  slider.addEventListener("mouseenter", () => { hovering = true; stop(); });
  slider.addEventListener("mouseleave", () => { hovering = false; start(); });
  carousel.addEventListener("touchstart", stop, { passive: true });
  carousel.addEventListener("touchend", () => setTimeout(start, 4000));

  updateDots();
  start();
})();
