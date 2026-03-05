/**
 * Firebase Cloud Functions Skeleton para Griviti POS
 *
 * Estas funciones están diseñadas para ejecutarse en el entorno backend de Firebase,
 * optimizando el uso de recursos y asegurando llamadas API (ej. Vertex AI) de forma segura.
 */

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

/**
 * 1. CIERRE DE CAJA (End of Day Summary)
 *
 * Esta función consolida todas las ventas del día (`Ventas_Historicas`),
 * genera un reporte diario, cierra el documento del día y lo mueve a
 * una colección de "Resumen_Diario" o lo exporta, aliviando la carga
 * computacional del lado del cliente.
 */
exports.cierreDeCaja = onCall(async (request) => {
  // Lógica de validación de usuario (Asegurar que sea admin o autorizado)
  /*
  if (!request.auth || !request.auth.token.admin) {
    throw new Error('Solo administradores pueden hacer cierre de caja.');
  }
  */

  try {
    // 1. Obtener todas las ventas del día actual desde Firestore
    // 2. Sumar totales (efectivo, transferencias, propinas, empaques)
    // 3. Crear documento en 'Resumenes_Diarios'
    // 4. Limpiar/Archivar las 'Ventas_Historicas'
    // 5. Retornar mensaje de éxito
    return {
      status: 'success',
      message: 'Cierre de caja procesado correctamente en el servidor.',
      data: {
        // ... totales resumidos
      },
    };
  } catch (error) {
    console.error('Error en cierreDeCaja:', error);
    return { status: 'error', message: error.toString() };
  }
});

/**
 * 2. RECOMENDACIONES CON VERTEX AI (Gemini 1.5 Flash)
 *
 * Esta función recibe el carrito de compras actual del cliente y
 * utiliza el SDK de Vertex AI para sugerir un producto adicional o "combo"
 * que haga sentido, basado en reglas o modelo de IA.
 * Requiere configurar la API Key de Vertex AI en las variables de entorno de Functions.
 */
exports.recomendarProductoAI = onCall(async (request) => {
  const { cartItems } = request.data;

  if (!cartItems || cartItems.length === 0) {
    return {
      recomendacion:
        'Te sugerimos probar nuestras famosas Hamburguesas Clásicas.',
    };
  }

  try {
    // Ejemplo de inicialización de cliente Vertex (A implementar por el usuario)
    // const { VertexAI } = require('@google-cloud/vertexai');
    // const vertexAI = new VertexAI({project: 'sistema-demo-9a04f', location: 'us-central1'});
    // const model = vertexAI.getGenerativeModel({model: 'gemini-1.5-flash'});

    /*
    const prompt = `El cliente ha pedido: ${cartItems.map(i => i.nombre).join(', ')}. 
                    Sugiérele un único producto pequeño adicional (como una bebida, salsa o postre) para complementar su orden de forma atractiva.`;
    const resp = await model.generateContent(prompt);
    */

    // Mock response for now
    return {
      recomendacion:
        '¡Completa tu orden con una gaseosa fría o unas papas adicionales! (Respuest Mock AI)',
    };
  } catch (error) {
    console.error('Error en AI:', error);
    return { recomendacion: '' };
  }
});
