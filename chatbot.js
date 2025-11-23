import express from "express";
import axios from "axios";

// ----------------------------------------------------
// 1. CONFIGURACIÓN: Variables de Entorno y Constantes
// ----------------------------------------------------
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WASENDER_API = process.env.WASENDER_API;
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; 
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; 

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// 🚩 URLS DE MEDIOS
const VIDEO_BIENVENIDA_URL = 'https://drive.google.com/file/d/1W90iW4nJy7pqvraA--FJTT_HQQw3h4uJ/view';
const PAUSA_ENTRE_MENSAJES = 6000;

// Persistencia simple
const mensajesProcesados = new Set();
const contextoProductoUsuario = new Map();

function stripAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ----------------------------------------------------
// ⭐ FUNCIÓN QUE TE SOLUCIONÓ EL PROBLEMA (VERSIÓN OFICIAL)
// ----------------------------------------------------
function normalizarNumero(numeroRaw) {
    let numero = numeroRaw.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
    console.log("📞 Número crudo:", numero);

    // Telcel manda basura → extraemos los últimos 10 siempre
    if (numero.length > 10) {
        numero = "521" + numero.slice(-10);
        console.log("🔧 Telcel corregido →", numero);
        return numero;
    }

    if (numero.length === 10) {
        numero = "521" + numero;
        console.log("🔧 Local corregido →", numero);
        return numero;
    }

    if (numero.length === 12 && numero.startsWith("521")) {
        console.log("👍 Correcto:", numero);
        return numero;
    }

    console.log("❌ Número inválido:", numeroRaw);
    return null;
}

// ----------------------------------------------------
// 2. SERVICIOS EXTERNOS Y UTILIDADES
// ----------------------------------------------------

async function enviarTextoWasender(numero, text) {
    try {
        await axios.post(WASENDER_API, {
            to: numero,
            text: text
        }, {
            headers: { 'Authorization': `Bearer ${WASENDER_API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`💬 Mensaje enviado a ${numero}`);
    } catch (error) {
        console.error('❌ Error al enviar texto:', error.response?.data || error.message);
    }
}

async function enviarImagenWasender(numero, url, caption = '') {
    try {
        await axios.post(WASENDER_API, {
            to: numero,
            image: { url: url },
            caption: caption
        }, {
            headers: { 'Authorization': `Bearer ${WASENDER_API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`🖼️ Imagen enviada a ${numero}`);
        return true;
    } catch (error) {
        console.error('❌ Error al enviar imagen:', error.response?.data || error.message);
        return false;
    }
}

async function notificarSlack(numero, mensajeCliente) {
    if (!SLACK_WEBHOOK_URL) return;

    const WA_LINK = `https://wa.me/${numero}`;
    const slackPayload = {
        text: `<${WA_LINK}|Cliente ${numero}: ${mensajeCliente}>`,
        username: 'Bot Alert',
        icon_emoji: ':robot_face:',
    };

    try {
        await axios.post(SLACK_WEBHOOK_URL, slackPayload);
        console.log("✅ Alerta enviada");
    } catch (e) {
        console.error("❌ Slack error:", e.message);
    }
}

async function obtenerRespuestaOpenRouter(texto, contexto) {
    try {
        const prompt = [
            {
                role: 'system',
                content:
                    `Eres asistente de ventas en Karen's Clothes.
                     SI EL CLIENTE PIDE PRODUCTO, FOTO, PRECIO, TALLA O STOCK → responde SOLO: "COMANDO_ESCALAR".`
            },
            { role: "system", content: contexto },
            { role: "user", content: texto }
        ];

        const r = await axios.post(OPENROUTER_API_URL, {
            model: "gpt-4o-mini",
            messages: prompt
        }, {
            headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
        });

        return r.data.choices[0].message.content.trim();
    } catch {
        return "COMANDO_ESCALAR_FALLO";
    }
}

// ----------------------------------------------------
// 3. LÓGICA PRINCIPAL
// ----------------------------------------------------
async function procesarMensajes(body) {

    let msg = body?.data?.messages;
    if (!msg) return;
    const mensajes = Array.isArray(msg) ? msg : [msg];

    for (const msgObj of mensajes) {

        const msgId = msgObj.key?.id;
        if (!msgId || mensajesProcesados.has(msgId)) continue;
        mensajesProcesados.add(msgId);

        if (!msgObj.message || msgObj.key.fromMe) continue;

        // Obtener texto
        let texto = '';
        if (msgObj.message?.conversation) texto = msgObj.message.conversation;
        else if (msgObj.message?.extendedTextMessage?.text) texto = msgObj.message.extendedTextMessage.text;
        else if (msgObj.message?.imageMessage?.caption) texto = msgObj.message.imageMessage.caption;

        const numeroRaw = msgObj.key?.remoteJid;
        if (!numeroRaw) continue;

        // -----------------------------------------------------------
        // 🚫 BLOQUEO 100% DE GRUPOS
        // -----------------------------------------------------------
        if (numeroRaw.endsWith("@g.us")) {
            console.log("🚫 Mensaje de grupo bloqueado");
            continue;
        }

        // -----------------------------------------------------------
        // 🔥 AQUI SE AGREGA TU FIX EXACTO (normalizarNumero)
        // -----------------------------------------------------------
        let numero = normalizarNumero(numeroRaw);
        if (!numero) continue;

        // -----------------------------------------------------------
        // 🔥 ANALISIS DE TEXTO
        // -----------------------------------------------------------
        const textoLower = texto.toLowerCase();
        const textoSinTildes = stripAccents(textoLower);

        const bienvenidaKey = "bienvenida_" + numero;

        const mensajePago =
            `💰 *PAGO / ANTICIPO*\n\n` +
            `Scotiabank\n` +
            `👤 José de Jesús Conchas Rodriguez\n` +
            `CLABE: 044320256058512878\n` +
            `Tarjeta: 5579209154257585\n\n` +
            `Envíame tu comprobante para continuar.`;

        const mensajeDinamica =
            `Por favor revisa nuestro video de dinámica (30 segundos):\n${VIDEO_BIENVENIDA_URL}`;

        const mensajeRecurrente =
            `¡Hola de nuevo! 😊 Aquí está nuevamente nuestra dinámica:\n${VIDEO_BIENVENIDA_URL}`;

        // IMAGEN
        if (msgObj.message.imageMessage) {
            await notificarSlack(numero, "Imagen de pedido");
            await enviarTextoWasender(numero,
                `¡Gracias! Una asesora revisará tu pedido.\n\n${mensajePago}`
            );
            continue;
        }

        // SALUDO SIMPLES REPETIDOS
        const esSaludo = textoSinTildes.includes("hola")
            || textoSinTildes.includes("buenas")
            || textoSinTildes.includes("hi");

        if (esSaludo && mensajesProcesados.has(bienvenidaKey)) {
            await enviarTextoWasender(numero, mensajeRecurrente);
            continue;
        }

        // PAGOS
        if (
            textoSinTildes.includes("pago") ||
            textoSinTildes.includes("anticipo") ||
            textoSinTildes.includes("transferencia")
        ) {
            await enviarTextoWasender(numero, mensajePago);
            mensajesProcesados.add(bienvenidaKey);
            continue;
        }

        // DINÁMICA
        if (
            textoSinTildes.includes("mecanica") ||
            textoSinTildes.includes("dinamica") ||
            textoSinTildes.includes("pedido") ||
            textoSinTildes.includes("comprar")
        ) {
            await enviarTextoWasender(numero, mensajeDinamica);
            mensajesProcesados.add(bienvenidaKey);
            continue;
        }

        // BIENVENIDA NUEVOS
        if (!mensajesProcesados.has(bienvenidaKey)) {

            const bienvenida1 =
                `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** 🩷\n\n` +
                `¿Tienes tienda o manejas sobre pedido?\n\n` +
                `Nuestro Facebook oficial:\nhttps://www.facebook.com/share/19928ADEfk/\n\n` +
                mensajeDinamica;

            const bienvenida2 =
                `🎁 *PROMOCIONES PRIMERA COMPRA*\n\n` +
                `• Compra desde *$4000* → precio de corrida (-$10 por prenda)\n` +
                `• Compra desde *$6000* → precio de paquete (-$20 por prenda)\n`;

            await enviarTextoWasender(numero, bienvenida1);
            await enviarTextoWasender(numero, bienvenida2);

            mensajesProcesados.add(bienvenidaKey);
            continue;
        }

        // IA
        const respuestaIA = await obtenerRespuestaOpenRouter(texto, "asistente de ventas");

        if (respuestaIA.includes("COMANDO_ESCALAR")) {
            await notificarSlack(numero, texto);
            await enviarTextoWasender(numero,
                `Estoy canalizando tu mensaje con una vendedora experta 👗✨`
            );
            continue;
        }

        await enviarTextoWasender(numero, respuestaIA);
    }
}

// ----------------------------------------------------
// 4. WEBHOOK
// ----------------------------------------------------
app.get("/", (req, res) => res.send("BOT CORRIENDO"));

app.post("/webhook", (req, res) => {
    res.sendStatus(200);
    procesarMensajes(req.body);
});

// ----------------------------------------------------
// 5. INICIO
// ----------------------------------------------------
app.listen(PORT, () => console.log("🤖 BOT ACTIVO EN PUERTO", PORT));
