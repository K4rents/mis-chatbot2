import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ---------------------- CONFIG ----------------------
const PORT = process.env.PORT || 10000;
const WASENDER_API = process.env.WASENDER_API;
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const PAUSA = 6000;

// 🔥 URLs que sí usas
const VIDEO_BIENVENIDA_URL = "https://drive.google.com/file/d/1W90iW4nJy7pqvraA--FJTT_HQQw3h4uJ/view";
const URL_MECANICA_COMPRA = "https://drive.google.com/file/d/163YfomYIO9JojMvQGy7VUa0EkV1tXKLe/view?usp=sharing";

// ---------------------- UTILIDADES ----------------------
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

function stripAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function esGrupo(jid) {
    return jid.endsWith("@g.us"); // ← BLOQUEO DE GRUPOS
}

// ---------------------- SERVICIOS WASENDER ----------------------
async function enviarTexto(numero, text) {
    try {
        await axios.post(WASENDER_API, { to: numero, text }, {
            headers: { Authorization: `Bearer ${WASENDER_API_KEY}` }
        });
    } catch (e) {
        console.error("❌ Error enviarTexto:", e.response?.data || e);
    }
}

async function enviarImagen(numero, url, caption = "") {
    try {
        await axios.post(WASENDER_API, {
            to: numero,
            image: { url },
            caption
        }, {
            headers: { Authorization: `Bearer ${WASENDER_API_KEY}` }
        });
    } catch (e) {
        console.error("❌ Error enviarImagen:", e.response?.data || e);
    }
}

// ---------------------- SLACK (MEJORADO PARA DIAGNÓSTICO) ----------------------
async function notificarSlack(numero, mensaje) {
    if (!SLACK_WEBHOOK_URL) {
        console.error("❌ ERROR SLACK: SLACK_WEBHOOK_URL no está definido. No se puede enviar la alerta.");
        return;
    }

    const WA = `https://wa.me/${numero}`;
    const payload = {
        text: `<${WA}|🚨 *ESCALAMIENTO*: ${numero} — "${mensaje}">`,
        username: "Boutique Bot",
        icon_emoji: ":robot_face:"
    };

    try {
        await axios.post(SLACK_WEBHOOK_URL, payload);
        console.log(`✅ SLACK: Alerta enviada con éxito para el número ${numero}`);
    } catch (e) {
        // Muestra el error real que impide el envío
        console.error("❌ ERROR SLACK POST: Falló el envío del webhook.", e.response?.data || e.message);
    }
}

// ---------------------- OPENROUTER ----------------------
async function obtenerRespuestaIA(mensaje, contexto) {
    try {
        const r = await axios.post(OPENROUTER_API_URL, {
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content:
                        `Eres un asistente de ventas de ropa de Karen's Clothes. ` +
                        `Si el usuario pregunta por productos, tallas, precios o quiere comprar, responde SOLO "COMANDO_ESCALAR".`
                },
                { role: "system", content: contexto },
                { role: "user", content: mensaje }
            ]
        }, {
            headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
        });

        return r.data.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ OpenRouter:", e.response?.data || e);
        return "COMANDO_ESCALAR";
    }
}

// ---------------------- MENSAJES --------------------------------

const MENSAJE_PAGO = `¡Hola! Con gusto te comparto los datos. Para realizar tu *ANTICIPO O PAGO RÁPIDO* 💰 puedes usar nuestros datos de Scotiabank:

*👤 BENEFICIARIO:* José de Jesús Conchas Rodriguez
*🏦 BANCO:* Scotiabank
*CLABE:* 044320256058512878
*Tarjeta:* 5579209154257585

_Recuerda enviar tu comprobante al chat para que tu pedido avance._`;

// Leyenda amable mejorada
const MENSAJE_VIDEO = `¡Con gusto! Para que todo sea súper claro y rápido, mira este breve video (solo 30 segundos) donde te explicamos paso a paso nuestra dinámica de compra: ${VIDEO_BIENVENIDA_URL}`;

const SALUDO_EXISTENTE = `¡Hola de nuevo! 😊 ¿En qué puedo ayudarte hoy? Aquí está la dinámica: ${VIDEO_BIENVENIDA_URL}`;

const MENSAJE_CORTESIA = `¡Seguimos en línea para lo que se ofrezca! 😊`;

const MENSAJE_CATALOGO = `¡Claro! 🛍️ Con gusto te conectamos con una vendedora. Te enviará nuestro catálogo actualizado para que puedas hacer tu pedido.`;

const MENSAJE_ESCALA_ENVIO = `¡Entendido! Para darte la información más precisa sobre costos y tiempos de envío, te conecto con una vendedora experta. ¡Gracias por tu paciencia!`;

const MENSAJE_GUADALAJARA = `¡Excelente! Sí, hacemos entregas personales en Guadalajara. Un asesor se agendará contigo para coordinar dónde puedes pasar a recoger tu pedido.`; 

const MENSAJE_DEVOLUCION = `Entiendo. Manejaremos tu solicitud con gusto. Te conectaremos con una vendedora para que te ayude personalmente con el proceso de devolución o cambio.`;

const MENSAJE_ASESORIA = `¡Esa es una excelente pregunta! Para darte la mejor asesoría estratégica y personalizada sobre negocio o recomendaciones, te conecto con una de nuestras vendedoras expertas.`;

const MENSAJE_CONFIRMACION_ESCALA = `¡Perfecto! Ya te estamos conectando con una vendedora experta. En breve estará contigo para ayudarte con tu solicitud.`;


// ---------------------- MEMORIA BÁSICA ----------------------
const memoriaBienvenida = new Set();
const mensajesProcesados = new Set();

// ---------------------- LÓGICA PRINCIPAL ----------------------
async function procesar(body) {
    if (body?.event === "webhook.test") return;

    const mensajes = body?.data?.messages;
    if (!mensajes) return;

    const lista = Array.isArray(mensajes) ? mensajes : [mensajes];

    for (const m of lista) {
        const msgId = m.key?.id;
        if (!msgId || mensajesProcesados.has(msgId)) continue;
        mensajesProcesados.add(msgId);

        if (m.key?.fromMe) continue;

        const jid = m.key?.remoteJid;
        if (!jid) continue;

        if (esGrupo(jid)) {
            console.log("⛔ Mensaje ignorado de grupo");
            continue;
        }

        const numero = jid.replace(/@s\.whatsapp\.net$/, "");

        // Obtener texto
        let texto = "";
        if (m.message?.conversation) texto = m.message.conversation;
        else if (m.message?.extendedTextMessage?.text) texto = m.message.extendedTextMessage.text;
        else if (m.message?.imageMessage?.caption) texto = m.message.imageMessage.caption;

        if (!texto) continue;

        const clean = stripAccents(texto.toLowerCase());

        const bienvenidaKey = `welc_${numero}`;

        // ---------------------- 🤝 CORTESÍA (ALTA PRIORIDAD, RESPUESTA FINAL) ----------------------
        const buscaCortesia = 
            clean.includes("ok") || clean.includes("va") || 
            clean.includes("gracias") || clean.includes("vale");

        if (buscaCortesia && clean.length <= 10) { // Limita a mensajes cortos
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_CORTESIA);
            continue;
        }

        // ---------------------- ✅ CONFIRMACIÓN DE ESCALAMIENTO (SIN DATOS DE PAGO) ----------------------
        const buscaConfirmacion = clean.includes("si") || clean.includes("claro") || clean.includes("conecta") || clean.includes("adelante") || clean.includes("acepto"); 
        
        if (buscaConfirmacion && clean.length < 20) { // Solo mensajes cortos de confirmación
            await notificarSlack(numero, `Cliente confirma escalamiento: ${texto}`);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_CONFIRMACION_ESCALA);
            continue;
        }
        
        // ---------------------- 🎯 DINÁMICA (ALTA PRIORIDAD, NO ESCALA) ----------------------
        // Combinaciones que indican "CÓMO HACER" algo
        const preguntaComoHacer = 
            clean.includes("como") && 
            (clean.includes("compra") || clean.includes("pedido") || clean.includes("hace") || clean.includes("realiza") || clean.includes("ordenar") || clean.includes("hago") || clean.includes("pedio"));
            
        // Palabras clave únicas que siempre deben mandar el video
        const palabrasClaveDinamica = 
            clean.includes("mecanica") || 
            clean.includes("dinamica") ||
            clean.includes("proceso"); 

        // Si se cumple la combinación "COMO HACER" O si usa una palabra clave
        if (preguntaComoHacer || palabrasClaveDinamica) {
            memoriaBienvenida.add(bienvenidaKey);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_VIDEO);
            continue; 
        }
        
        // ---------------------- ESCALAMIENTO AUTOMÁTICO POR IMAGEN (con texto de pedido) ----------------------
        if (m.message?.imageMessage && (clean.includes("pedido") || clean.includes("orden") || clean.includes("comprar"))) {
            await notificarSlack(numero, "Imagen/Pedido");
            await delay(PAUSA);
            await enviarTexto(numero, `¡Recibido! 📦 Conectando con una vendedora para confirmar stock, tallas y pago.\n\n${MENSAJE_PAGO}`);
            continue;
        }

        // ---------------------- 📄 ESCALAMIENTO POR COMPROBANTE DE PAGO ----------------------
        const esImagenODocumento = m.message?.imageMessage || m.message?.documentMessage;
        const buscaComprobante = clean.includes("comprobante") || clean.includes("pago") || clean.includes("validacion") || clean.includes("transferencia");

        if (esImagenODocumento && buscaComprobante) {
            await notificarSlack(numero, `💸 *COMPROBANTE RECIBIDO* (${m.message?.documentMessage ? 'Documento' : 'Imagen'}): ${texto}`);
            await delay(PAUSA);
            await enviarTexto(
                numero,
                `¡Comprobante recibido! ✅ En un momento una vendedora lo validará y continuará con tu pedido. ¡Gracias por tu compra!`
            );
            continue;
        }
        
        // ---------------------- 📍 GUADALAJARA (PICKUP LOCAL - ESCALA) ----------------------
        if (clean.includes("guadalajara")) {
            await notificarSlack(numero, `Pickup Guadalajara: ${texto}`);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_GUADALAJARA);
            continue;
        }
        
        // ---------------------- 🔄 DEVOLUCIÓN / CAMBIO (ESCALAMIENTO CON RESPUESTA AMABLE) ----------------------
        const buscaDevolucion = clean.includes("devolucion") || clean.includes("cambio") || clean.includes("regresar");

        if (buscaDevolucion) {
            await notificarSlack(numero, `Solicitud de Devolución/Cambio: ${texto}`);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_DEVOLUCION);
            continue;
        }

        // ---------------------- 📈 CONSULTA DE NEGOCIO / CONSEJO (ESCALAMIENTO AMABLE) ----------------------
        const buscaConsejo = clean.includes("consejo") || clean.includes("recomienda") || clean.includes("negocio") || clean.includes("opinion");

        if (buscaConsejo) {
            await notificarSlack(numero, `Consulta de Negocio/Asesoría: ${texto}`);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_ASESORIA);
            continue;
        }

        // ---------------------- ❓ INFO / INFORMACION (ALTA PRIORIDAD) ----------------------
        const buscaInfo = clean.includes("info") || clean.includes("informacion") || clean.includes("infrmacion");

        if (buscaInfo) {
            memoriaBienvenida.add(bienvenidaKey);

            await delay(PAUSA);
            await enviarTexto(
                numero,
                `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** y estoy encantada de atenderte. ✨

¿Tienes tienda o te manejas sobre pedido?

Página oficial: https://www.facebook.com/share/19928ADEfk/

${MENSAJE_VIDEO}`
            );

            await delay(PAUSA);

            await enviarTexto(
                numero,
                `¡Realiza tu **primera compra** y llévate un cupón! 🎁

1.- Compra mínima *$4000*: precio de corrida (10 pesos menos por prenda)
2.- Compra mínima *$6000*: precio de paquete (20 pesos menos por prenda)`
            );
            continue;
        }

        // ---------------------- 📒 CATÁLOGO (ESCALAMIENTO) ----------------------
        // Detección: Base "catalogo" (con o sin acento) y el error "catalago".
        const buscaCatalogo = clean.includes("catalogo") || clean.includes("catalago"); 

        if (buscaCatalogo) {
            await notificarSlack(numero, `Solicitud de Catálogo: ${texto}`); // ESCALA AL VENDEDOR
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_CATALOGO); // RESPUESTA AMABLE SIN DATOS DE PAGO
            continue;
        }

        // ---------------------- SALUDO SIMPLE DE CLIENTE EXISTENTE ----------------------
        const esSaludo = clean.includes("hola") || clean.includes("buenas") || clean.length < 10;

        if (esSaludo && memoriaBienvenida.has(bienvenidaKey)) {
            await delay(PAUSA);
            await enviarTexto(numero, SALUDO_EXISTENTE);
            continue;
        }

        // ---------------------- 💰 PAGO (PREGUNTA DIRECTA - NO ESCALA) ----------------------
        // Manda cuenta, NO ESCALA.
        const buscaPago =
            clean.includes("pago") || clean.includes("deposito") ||
            clean.includes("transferencia") || clean.includes("anticipo") ||
            clean.includes("cuenta") || clean.includes("scotia") ||
            clean.includes("tarjeta") || clean.includes("transfiero");

        if (buscaPago) {
            memoriaBienvenida.add(bienvenidaKey);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_PAGO);
            continue;
        }
        
        // ---------------------- 🚛 ENVIOS (ESCALAMIENTO, NO DATOS DE PAGO) ----------------------
        // Escala al vendedor, NO da información ni datos de pago.
        const buscaEnvios =
            clean.includes("envio") || clean.includes("paqueteria") ||
            clean.includes("costo") || clean.includes("mandas") ||
            clean.includes("republica") || clean.includes("mexico");

        if (buscaEnvios) {
            await notificarSlack(numero, `Consulta de Envíos: ${texto}`);
            await delay(PAUSA);
            await enviarTexto(numero, MENSAJE_ESCALA_ENVIO);
            continue; 
        }

        // ---------------------- CLIENTE NUEVO (BIENVENIDA COMPLETA) ----------------------
        // Este bloque ahora solo se activa si no se ha enviado el mensaje AÚN
        if (!memoriaBienvenida.has(bienvenidaKey)) {
            memoriaBienvenida.add(bienvenidaKey);

            await delay(PAUSA);
            await enviarTexto(
                numero,
                `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** y estoy encantada de atenderte. ✨

¿Tienes tienda o te manejas sobre pedido?

Página oficial: https://www.facebook.com/share/19928ADEfk/

${MENSAJE_VIDEO}`
            );

            await delay(PAUSA);

            await enviarTexto(
                numero,
                `¡Realiza tu **primera compra** y llévate un cupón! 🎁

1.- Compra mínima *$4000*: precio de corrida (10 pesos menos por prenda)
2.- Compra mínima *$6000*: precio de paquete (20 pesos menos por prenda)`
            );

            continue;
        }

        // ---------------------- 🛒 LÓGICA IA / ESCALAMIENTO (INCLUYE INTENCIÓN DE COMPRA) ----------------------
        // ESCALA Y MANDA CUENTA.
        const intencionComprar =
            clean.includes("quiero comprar") ||
            clean.includes("voy a comprar") ||
            clean.includes("quiero hacer una compra") ||
            clean.includes("quiero realizar una compra") ||
            clean.includes("comprar") || 
            clean.includes("pedido") ||
            clean.includes("orden") ||
            clean.includes("hacer") ||
            clean.includes("realizo");

        const respIA = await obtenerRespuestaIA(texto, "Asistente de ventas Karen's Clothes.");

        // Si la IA dice escalar O si detectamos intención directa de comprar, escalamos.
        if (respIA.includes("COMANDO_ESCALAR") || intencionComprar) {
            await notificarSlack(numero, texto); // Alerta
            await delay(PAUSA);

            // Respuesta con conexión y datos de pago
            await enviarTexto(
                numero,
                `¡Excelente! Tu pedido está en buenas manos. Te conecto con una vendedora experta para confirmar stock y tallas.\n\n${MENSAJE_PAGO}`
            );
            continue;
        }

        // IA respondió algo normal
        await delay(PAUSA);
        await enviarTexto(numero, respIA);
    }
}

// ---------------------- WEBHOOK ----------------------
app.get("/", (_, res) => res.send("Chatbot activo!"));
app.post("/webhook", (req, res) => {
    res.sendStatus(200);
    procesar(req.body);
});

// ---------------------- RUN ----------------------
app.listen(PORT, () => console.log(`🤖 Bot en puerto ${PORT}`));
