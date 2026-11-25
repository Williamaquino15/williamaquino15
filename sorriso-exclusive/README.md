# Simulador de sorriso – Exclusive Odontologia

Página estática (HTML/CSS/JS, sem build). A foto é processada no navegador e nunca é enviada.

## Configurar
No topo do `<script>` de `index.html`, objeto `CONFIG`:
- `whatsapp`: número da clínica (DDI+DDD+número, só dígitos).
- `endpoint`: URL que recebe o lead (nome/telefone) por POST. Vazio = abre o WhatsApp com mensagem pronta.

## Publicar (necessário HTTPS para a câmera funcionar no celular)
Arraste a pasta `sorriso-exclusive` em https://app.netlify.com/drop, ou use GitHub Pages / Cloudflare Pages / Vercel.

## Limitações
Simula apenas clareamento (detecção dos dentes via MediaPipe). Não simula alinhamento.
