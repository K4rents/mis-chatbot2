import express from "express";
import axios from "axios";

// ----------------------------------------------------
// 1. CONFIGURACIÓN
// ----------------------------------------------------
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const WASENDER_API = process.env.WASENDER_API;
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const VIDEO_BIENVENIDA_URL = "https://drive.google.com/file/d/1W90iW4nJy7pqvraA--FJTT_HQQw3h4uJ/view";
const URL_MECANICA_COMPRA = "https://drive.google.com/file/d/163YfomYIO9JojMvQGy7VUa0EkV1tXKLe/view?usp=sharing";

const PAUSA_ENTRE_MENSAJES = 6000;

const mensajesProcesados = new Set();

function stripAccents(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ----------------------------------------------------
// 2. SERVICIOS WASENDER
// ----------------------------------------------------
async function enviarTextoWasender(numero, text) {
    try {
        await axios.post(
            WASENDER_API,
            { to: numero, text },
            {
                headers: {
                    Authorization: `Bearer ${WASENDER_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log(`💬 Mensaje enviado a ${numero}: ${text.substring(0, 50)}...`);
    } catch (error) {
        console.error("❌ Error al enviar texto:", error.response?.data || error.message);
    }
}

async function enviarImagenWasender(numero, url, caption = "") {
    try {
        await axios.post(
            WASENDER_API,
            { to: numero, image: { url }, caption },
            {
                headers: {
                    Authorization: `Bearer ${WASENDER_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log(`🖼️ Imagen enviada a ${numero}.`);
    } catch (error) {
        console.error("❌ Error imagen:", error.response?.data || error.message);
    }
}

// ----------------------------------------------------
// 3. SLACK
// ----------------------------------------------------
async function notificarSlack(numero, mensajeCliente) {
    if (!SLACK_WEBHOOK_URL) return;

    const WA_LINK = `https://wa.me/${numero}`;
    const payload = {
        text: `<${WA_LINK}|🚨 Escalamiento: Cliente ${numero} – "${mensajeCliente}">`,
        username: "Karen's Bot",
        icon_emoji: ":robot_face:",
    };

    try {
        await axios.post(SLACK_WEBHOOK_URL, payload);
        console.log("📢 Notificación enviada a Slack.");
    } catch (e) {
        console.error("❌ Error Slack:", e.message);
    }
}

// ----------------------------------------------------
// 4. IA OPENROUTER
// ----------------------------------------------------
async function obtenerRespuestaOpenRouter(mensaje, contexto) {
    try {
        const response = await axios.post(
            OPENROUTER_API_URL,
            {
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content:
                            `Eres un asistente de ventas. Si el usuario pregunta por producto, precio, talla o compra, responde "COMANDO_ESCALAR".`,
                    },
                    { role: "system", content: contexto },
                    { role: "user", content: mensaje },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.choices[0].message.content.trim();
    } catch (e) {
        return "COMANDO_ESCALAR_FALLO";
    }
}

// ----------------------------------------------------
// 5. PROCESAMIENTO DE MENSAJES
// ----------------------------------------------------
async function procesarMensajes(body) {
    if (body?.event === "webhook.test") return;

    let mensajes = body?.data?.messages;
    if (!mensajes) return;

    mensajes = Array.isArray(mensajes) ? mensajes : [mensajes];

    for (const msg of mensajes) {
        const msgId = msg.key?.id;
        if (!msgId || mensajesProcesados.has(msgId)) continue;
        mensajesProcesados.add(msgId);

        if (!msg.message || msg.key.fromMe) continue;

        let texto =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            "";

        if (!texto) continue;

        let numeroRaw = msg.key?.remoteJid || msg.remoteJid;
        if (!numeroRaw) continue;

        // ❌ Bloquear grupos
        if (numeroRaw.endsWith("@g.us")) {
            console.log("⛔ Grupo bloqueado:", numeroRaw);
            continue;
        }

        // ------------------------------------------
        // 🔥 ANTI-TELCEL: extraer SIEMPRE el número real
        // ------------------------------------------
        let soloDigitos = numeroRaw.replace(/\D/g, "");
        let numeroReal = soloDigitos.slice(-10); // últimos 10 dígitos

        if (numeroReal.length !== 10) {
            console.log("⛔ Número inválido:", soloDigitos);
            continue;
        }

        console.log("✅ Cliente real:", numeroReal);

        const textoLower = texto.toLowerCase();
        const textoSinTildes = stripAccents(textoLower);

        const bienvenidaKey = `bienvenida_${numeroReal}`;

        const mensajePago =
            `*Pago rápido 💰*\nBeneficiario: José de Jesús Conchas Rodriguez\n` +
            `Banco: Scotiabank\nCLABE: 044320256058512878\nTarjeta: 5579209154257585`;

        const mensajeDinamicaVideo = `Por favor mira nuestro video de bienvenida (30s): ${VIDEO_BIENVENIDA_URL}`;

        // -----------------------------------------------------
        // 1. IMAGEN DE PEDIDO
        // -----------------------------------------------------
        if (
            msg.message.imageMessage &&
            (textoSinTildes.includes("pedido") || textoSinTildes.includes("orden"))
        ) {
            await notificarSlack(numeroReal, texto);
            await enviarTextoWasender(
                numeroReal,
                `Recibí tu pedido 📦 Una asesora te contactará.\n\n${mensajePago}`
            );
            continue;
        }

        // -----------------------------------------------------
        // 2. PAGO
        // -----------------------------------------------------
        const buscaPago = ["pago", "anticipo", "deposito", "transferencia", "cuenta"].some((w) =>
            textoSinTildes.includes(w)
        );

        if (buscaPago) {
            await enviarTextoWasender(numeroReal, mensajePago);
            mensajesProcesados.add(bienvenidaKey);
            continue;
        }

        // -----------------------------------------------------
        // 3. MECÁNICA / DINÁMICA
        // -----------------------------------------------------
        const buscaDinamica = ["mecanica", "dinamica", "proceso", "orden", "pedido"].some((w) =>
            textoSinTildes.includes(w)
        );

        if (buscaDinamica) {
            await enviarTextoWasender(numeroReal, mensajeDinamicaVideo);
            mensajesProcesados.add(bienvenidaKey);
            continue;
        }

        // -----------------------------------------------------
        // 4. MENSAJE DE BIENVENIDA ÚNICO
        // -----------------------------------------------------
        if (!mensajesProcesados.has(bienvenidaKey)) {
            await enviarTextoWasender(
                numeroReal,
                `¡Hola! Soy Paola de Karen's Clothes ✨\n¿Tienes tienda o manejas por pedido?\n\n` +
                    `Nuestra página oficial: https://www.facebook.com/share/19928ADEfk/`
            );

            await enviarTextoWasender(numeroReal, mensajeDinamicaVideo);

            await enviarTextoWasender(
                numeroReal,
                `🎁 CUPONES:\n` +
                `• Compra mínima $4000 → Precio de corrida (–$10 por prenda)\n` +
                `• Compra mínima $6000 → Precio de paquete (–$20 por prenda)`
            );

            mensajesProcesados.add(bienvenidaKey);
            continue;
        }

        // -----------------------------------------------------
        // 5. ESCALAMIENTO (IA)
        // -----------------------------------------------------
        const respuestaIA = await obtenerRespuestaOpenRouter(texto, "Contexto de ventas");

        if (respuestaIA.includes("COMANDO_ESCALAR")) {
            await notificarSlack(numeroReal, texto);
            await enviarTextoWasender(numeroReal, `Ya te conecto con una vendedora 😊`);
            continue;
        }

        await enviarTextoWasender(numeroReal, respuestaIA);
    }
}

// ----------------------------------------------------
// 6. WEBHOOK
// ----------------------------------------------------
app.get("/", (req, res) => res.send("Bot activo " + PORT));

app.post("/webhook", (req, res) => {
    res.sendStatus(200);
    procesarMensajes(req.body);
});

// ----------------------------------------------------
// 7. INICIO
// ----------------------------------------------------
app.listen(PORT, () => {
    console.log("🤖 Chatbot corriendo en puerto " + PORT);
});
