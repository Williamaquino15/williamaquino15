// ===== CONFIGURAÇÃO — edite aqui =====
const CONFIG = {
  // Número do WhatsApp com DDI + DDD, só dígitos (ex.: 5519999999999)
  whatsapp: "5519000000000",
  whatsappMessage: "Olá! Vim pelo site e gostaria de agendar uma consulta com o Dr. Ramon Claros.",
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
