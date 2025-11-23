import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const WASENDER_API = process.env.WASENDER_API;
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const VIDEO_BIENVENIDA_URL =
  "https://drive.google.com/file/d/1W90iW4nJy7pqvraA--FJTT_HQQw3h4uJ/view";

const mensajesProcesados = new Set();

function stripAccents(str) {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// --------------------------------------------------
// 🔥 NORMALIZACIÓN TELCEL — LA QUE SÍ FUNCIONA
// --------------------------------------------------
function normalizarNumero(numeroRaw) {
  console.log("📞 Número crudo:", numeroRaw);

  let numero = numeroRaw.replace(/@s\.whatsapp\.net$/, "").replace(/\D/g, "");

  // Si Telcel envía números gigantes → tomamos últimos 10
  if (numero.length > 10) {
    const ultimos10 = numero.slice(-10);
    numero = "521" + ultimos10;
    console.log("🔧 Telcel corregido →", numero);
    return numero;
  }

  // Si es número mexicano normal
  if (numero.length === 10) {
    numero = "521" + numero;
    console.log("🔧 Local corregido →", numero);
    return numero;
  }

  // Ya tiene 521
  if (numero.length === 12 && numero.startsWith("521")) {
    console.log("👍 Ya correcto:", numero);
    return numero;
  }

  console.log("❌ Número inválido ignorado");
  return null;
}

// --------------------------------------------------
// WASENDER
// --------------------------------------------------
async function enviarTextoWasender(numero, text) {
  try {
    const r = await axios.post(
      WASENDER_API,
      { to: numero, text },
      { headers: { Authorization: `Bearer ${WASENDER_API_KEY}` } }
    );

    // Ignorar JID does not exist
    if (r?.data?.message === "JID does not exist on WhatsApp") {
      console.log("⚠ Número sin WhatsApp, ignorado:", numero);
      return;
    }

    console.log(`💬 Enviado a ${numero}`);
  } catch (error) {
    const msg = error.response?.data?.message;

    if (msg?.includes("JID does not exist")) {
      console.log("⚠ Número sin WhatsApp, ignorado:", numero);
      return;
    }

    console.error("❌ Error al enviar:", error.response?.data || error.message);
  }
}

async function enviarImagenWasender(numero, url, caption = "") {
  try {
    await axios.post(
      WASENDER_API,
      {
        to: numero,
        image: { url },
        caption,
      },
      { headers: { Authorization: `Bearer ${WASENDER_API_KEY}` } }
    );
    console.log("🖼️ Imagen enviada");
  } catch (e) {
    console.error("❌ Error img:", e.response?.data || e.message);
  }
}

// --------------------------------------------------
// SLACK
// --------------------------------------------------
async function notificarSlack(numero, mensaje) {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await axios.post(SLACK_WEBHOOK_URL, {
      text: `Cliente ${numero}: ${mensaje}`,
    });
  } catch (e) {
    console.error("Slack error:", e.message);
  }
}

// --------------------------------------------------
// IA
// --------------------------------------------------
async function obtenerRespuestaOpenRouter(texto, contexto) {
  try {
    const r = await axios.post(
      OPENROUTER_API_URL,
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres asistente de ventas de Karen's Clothes. Si el cliente pide precio, foto, stock o tallas → responde SOLO 'COMANDO_ESCALAR'.",
          },
          { role: "system", content: contexto },
          { role: "user", content: texto },
        ],
      },
      {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      }
    );

    return r.data.choices[0].message.content.trim();
  } catch {
    return "COMANDO_ESCALAR_FALLO";
  }
}

// --------------------------------------------------
// 🔥 PROCESAR MENSAJES
// --------------------------------------------------
async function procesarMensajes(body) {
  const msgList = body?.data?.messages;
  if (!msgList) return;

  const mensajes = Array.isArray(msgList) ? msgList : [msgList];

  for (const msgObj of mensajes) {
    const msgId = msgObj.key?.id;
    if (!msgId || mensajesProcesados.has(msgId)) continue;

    mensajesProcesados.add(msgId);

    if (msgObj.key.fromMe) continue;

    let texto = "";
    if (msgObj.message?.conversation)
      texto = msgObj.message.conversation;
    else if (msgObj.message?.extendedTextMessage?.text)
      texto = msgObj.message.extendedTextMessage.text;
    else if (msgObj.message?.imageMessage?.caption)
      texto = msgObj.message.imageMessage.caption;

    const numeroRaw = msgObj.key?.remoteJid;
    if (!numeroRaw) return;

    // 🚫 NO RESPONDER EN GRUPOS
    if (numeroRaw.endsWith("@g.us")) {
      console.log("🚫 Grupo ignorado.");
      continue;
    }

    // Normalizar número Telcel
    const numero = normalizarNumero(numeroRaw);
    if (!numero) continue;

    const textoLower = texto.toLowerCase();
    const textoSinTildes = stripAccents(textoLower);

    const bienvenidaKey = "bienvenida_" + numero;

    const mensajePago =
      "💰 *PAGO / ANTICIPO*\n\nScotiabank\n👤 José de Jesús Conchas Rodriguez\nCLABE: 044320256058512878\nTarjeta: 5579209154257585\n\nEnvíame tu comprobante para continuar.";

    const mensajeDinamica =
      `Por favor revisa nuestro video de dinámica:\n${VIDEO_BIENVENIDA_URL}`;

    const mensajeRecurrente =
      `¡Hola de nuevo! 😊 Aquí está nuevamente nuestra dinámica:\n${VIDEO_BIENVENIDA_URL}`;

    // 📦 Imagen → escalar
    if (msgObj.message.imageMessage) {
      await notificarSlack(numero, "Imagen de pedido");
      await enviarTextoWasender(
        numero,
        `¡Gracias! Una asesora revisará tu pedido.\n\n${mensajePago}`
      );
      continue;
    }

    // SALUDOS
    const esSaludo =
      textoSinTildes.includes("hola") ||
      textoSinTildes.includes("buenas") ||
      textoSinTildes.includes("hi");

    if (esSaludo && mensajesProcesados.has(bienvenidaKey)) {
      await enviarTextoWasender(numero, mensajeRecurrente);
      continue;
    }

    // PAGO
    if (
      textoSinTildes.includes("pago") ||
      textoSinTildes.includes("anticipo") ||
      textoSinTildes.includes("deposito")
    ) {
      await enviarTextoWasender(numero, mensajePago);
      mensajesProcesados.add(bienvenidaKey);
      continue;
    }

    // DINAMICA
    if (
      textoSinTildes.includes("dinamica") ||
      textoSinTildes.includes("mecanica") ||
      textoSinTildes.includes("comprar") ||
      textoSinTildes.includes("pedido")
    ) {
      await enviarTextoWasender(numero, mensajeDinamica);
      mensajesProcesados.add(bienvenidaKey);
      continue;
    }

    // BIENVENIDA NUEVOS
    if (!mensajesProcesados.has(bienvenidaKey)) {
      const bienvenida =
        `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** 🩷\n\n` +
        `¿Tienes tienda o manejas sobre pedido?\n\n` +
        `Facebook oficial:\nhttps://www.facebook.com/share/19928ADEfk/\n\n` +
        mensajeDinamica;

      const promo =
        `🎁 *PROMOCIONES PRIMERA COMPRA*\n\n` +
        `• Compra desde *$4000* → precio corrida (-$10 por prenda)\n` +
        `• Compra desde *$6000* → precio paquete (-$20 por prenda)\n`;

      await enviarTextoWasender(numero, bienvenida);
      await enviarTextoWasender(numero, promo);

      mensajesProcesados.add(bienvenidaKey);
      continue;
    }

    // IA / ESCALAMIENTO
    const respuestaIA = await obtenerRespuestaOpenRouter(
      texto,
      "asistente de ventas"
    );

    if (respuestaIA.includes("COMANDO_ESCALAR")) {
      await notificarSlack(numero, texto);
      await enviarTextoWasender(
        numero,
        "Estoy canalizando tu mensaje con una vendedora 👗✨"
      );
      continue;
    }

    await enviarTextoWasender(numero, respuestaIA);
  }
}

// --------------------------------------------------
// WEBHOOK
// --------------------------------------------------
app.get("/", (req, res) => res.send("BOT CORRIENDO"));

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  procesarMensajes(req.body);
});

// --------------------------------------------------
// INICIO
// --------------------------------------------------
app.listen(PORT, () => console.log("🤖 BOT ACTIVO EN", PORT));
