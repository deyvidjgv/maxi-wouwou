const app = {
  productos: [],
  pendientes: [],
  historial: [],
  carrito: [],
  pedidosWeb: [],
  user: null,
  nombreUsuario: '',
  rol: '',
  modo: localStorage.getItem('griviti_modo') || 'mesero',
  negocioId: 'griviti_main',
  isOffline: false,
  totalActual: 0,
  mesaAct: null,
  propinaActual: 0,
  catActual: 'hamburguesas',
  currentInvCat: 'hamburguesas',
  iconMapping: {
    hamburguesas: 'https://img.icons8.com/ultraviolet/40/hamburger.png',
    perros: 'https://img.icons8.com/ultraviolet/40/hot-dog.png',
    salchipapas:
      'https://img.icons8.com/external-icongeek26-outline-colour-icongeek26/64/external-stir-fry-mexican-food-icongeek26-outline-colour-icongeek26.png',
    bebidas: 'https://img.icons8.com/pulsar-gradient/48/soda-water.png',
  },
  // Banco de imágenes disponibles por categoría (rutas locales en /img/)
  IMAGE_BANK: {
    hamburguesas: [
      // Agrega aquí las fotos reales cuando las tengas, ej.:
      // { src: 'img/hamburguesa-sencilla.png', label: 'Sencilla' },
    ],
    perros: [
      { src: 'img/perro-sencillo.png', label: 'Perro Sencillo' },
      { src: 'img/perro-doble.png', label: 'Perro Doble' },
      { src: 'img/perro-tocineta.png', label: 'Perro Tocineta' },
    ],
    salchipapas: [
      // { src: 'img/salchipapa-clasica.png', label: 'Clásica' },
    ],
    bebidas: [
      // { src: 'img/coca-cola.png', label: 'Coca-Cola' },
    ],
    otros: [],
  },
  pagoEnProceso: false,
  init() {
    const firestore = firebase.firestore();
    this.db = firestore; // Referencia rápida

    // Habilitar persistencia de datos (Optimización de costos y offline)
    firestore.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('Persistencia fallida: Múltiples pestañas abiertas.');
      } else if (err.code === 'unimplemented') {
        console.warn('Persistencia no soportada por el navegador.');
      }
    });

    // Solo llamar a analytics si no estamos en local o si lo deseas
    try {
      firebase.analytics();
    } catch (e) {}

    const auth = firebase.auth();

    // 1. Sincronizar usuario actual y sus datos de Firestore
    auth.onAuthStateChanged(async (user) => {
      this.user = user;

      if (user) {
        // Obtener perfil detallado desde Firestore
        try {
          const userDoc = await firestore
            .collection('users')
            .doc(user.uid)
            .get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            this.nombreUsuario = userData.nombre || user.email.split('@')[0];
            this.rol = userData.rol || '';

            // Actualizar UI
            const emailEl = document.getElementById('txtUserEmail');
            if (emailEl)
              emailEl.innerText = `${this.nombreUsuario} (${this.rol})`;
          }
        } catch (e) {
          console.error('Error cargando perfil:', e);
        }

        // Cargar datos del restaurante si estamos en una vista de trabajo
        if (
          window.location.pathname.includes('admin.html') ||
          window.location.pathname.includes('mesero.html')
        ) {
          this.vincularDatos(firestore);
          this.initVincularPedidosWeb(firestore); // Escuchar pedidos web de clientes
          this.initEstadoTogglePedidos(); // Cargar estado inicial del toggle
        }
      }
    });
  },

  async purgarInventarioAhora() {
    console.log('Purgando inventario...');
    const menuRef = firebase
      .firestore()
      .collection('negocios')
      .doc(this.negocioId)
      .collection('menu')
      .doc('actual');
    await menuRef.update({ productos: [] });
    this.productos = [];
    this.notificar('⚠️ Inventario purgado por solicitud');
  },

  async initEstadoTogglePedidos() {
    try {
      const doc = await this.db
        .collection('negocios')
        .doc(this.negocioId)
        .get();
      if (doc.exists) {
        const activa = doc.data().pedidosWebActivos !== false; // default true
        this.actualizarVisualToggle(activa);
      }
    } catch (e) {
      console.error('Error cargando estado de pedidos web:', e);
    }
  },

  notificar(mensaje) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="material-symbols-rounded">check_circle</span> ${mensaje}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },

  async vincularDatos(firestore) {
    this.negocioRef = firestore.collection('negocios').doc(this.negocioId);

    // 1. Cargar Menú (Optimización de Lecturas)
    const LAST_MENU_KEY = 'griviti_menu_last_fetch';
    const lastFetch = localStorage.getItem(LAST_MENU_KEY);
    // Cache is valid for 12 hours to balance cost vs freshness for Admins/Waiters
    const isCacheValid =
      lastFetch && Date.now() - parseInt(lastFetch) < 12 * 60 * 60 * 1000;

    const menuDocRef = this.negocioRef.collection('menu').doc('actual');

    if (isCacheValid) {
      // Attempt to load from offline cache to save reads
      menuDocRef
        .get({ source: 'cache' })
        .then((doc) => {
          if (doc.exists) {
            this.productos = doc.data().productos || [];
            this._refreshMenuUI();
          } else {
            // If cache misses, force server fetch
            this._fetchMenuFromServer(menuDocRef, LAST_MENU_KEY);
          }
        })
        .catch((err) => {
          console.warn('Cache read failed, falling back to server', err);
          this._fetchMenuFromServer(menuDocRef, LAST_MENU_KEY);
        });
    } else {
      // Cache expired or missing, fetch from server
      this._fetchMenuFromServer(menuDocRef, LAST_MENU_KEY);
    }

    // Opcional: listener de bajo costo solo para "cambios"
    // Ya que usamos persistencia, onSnapshot local no cobra lectura adicional
    // si no hay cambios en el servidor.
    menuDocRef.onSnapshot({ includeMetadataChanges: true }, (doc) => {
      if (doc.exists && !doc.metadata.fromCache) {
        // Solo actualizamos si el cambio viene del servidor real
        this.productos = doc.data().productos || [];
        this._refreshMenuUI();
        localStorage.setItem(LAST_MENU_KEY, Date.now().toString());
      }
    });

    // 2. Vincular Pedidos
    const hoyString = this.getFechaHoy();

    this.negocioRef
      .collection('pedidos')
      .where('fechaCierre', '==', '') // Pedidos abiertos / pendientes
      .onSnapshot(
        (snapshot) => {
          this.pendientes = [];
          snapshot.forEach((doc) => {
            this.pendientes.push({ id: doc.id, ...doc.data() });
          });
          this.renderMesas();
          this.renderCocina();
        },
        (err) => console.error('Error en pedidos pendientes:', err),
      );
  },

  _refreshMenuUI() {
    const vInv = document.getElementById('v-inventario');
    if (vInv && vInv.style.display !== 'none') {
      this.renderInventorySummary();
      if (this.currentInvCat) this.renderInventoryList(this.currentInvCat);
    }
    if (this.catActual) this.setCat(this.catActual);
  },

  _fetchMenuFromServer(menuDocRef, cacheKey) {
    menuDocRef
      .get({ source: 'server' })
      .then((doc) => {
        if (doc.exists) {
          this.productos = doc.data().productos || [];
          this._refreshMenuUI();
          localStorage.setItem(cacheKey, Date.now().toString());
        }
      })
      .catch((err) => console.error('Server fetch failed', err));
  },

  // 2.5 Vincular Pedidos Externos (Web)
  async initVincularPedidosWeb(firestore) {
    firestore
      .collection('pedidos_externos')
      .where('estado', '==', 'pendiente')
      .onSnapshot(
        (snapshot) => {
          this.pedidosWeb = [];
          snapshot.forEach((doc) => {
            this.pedidosWeb.push({ id: doc.id, ...doc.data() });
          });

          if (
            document.getElementById('v-pedidosweb') &&
            document.getElementById('v-pedidosweb').style.display !== 'none'
          ) {
            this.renderPedidosWeb();
          }
        },
        (err) => console.error('Error en pedidos web:', err),
      );

    // Listener para el historial de los últimos 7 días
    const ultimos7Dias = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      ultimos7Dias.push(d.toISOString().split('T')[0]);
    }

    this.negocioRef
      .collection('pedidos')
      .where('fechaDia', 'in', ultimos7Dias)
      .onSnapshot(
        (snapshot) => {
          this.historial = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.pago && data.pago !== '') {
              this.historial.push({ id: doc.id, ...data });
            }
          });

          // Ordenar historial por fecha (descendente)
          this.historial.sort((a, b) => {
            const timeA = a.timestamp || new Date(a.fecha).getTime() || 0;
            const timeB = b.timestamp || new Date(b.fecha).getTime() || 0;
            return timeB - timeA;
          });

          // Renderizar secciones del dashboard si están visibles
          const reporteView = document.getElementById('v-reportetotal');
          if (reporteView && reporteView.style.display !== 'none') {
            if (document.getElementById('kpi-ventas')) {
              this.renderReporteDash();
            } else {
              this.renderVentas();
            }
            if (document.getElementById('analysisChart')) {
              this.renderGrafico();
            }
          }
        },
        (err) => console.error('Error en historial:', err),
      );
  },
  // El login ahora se maneja directamente en js/login.js

  cerrarSesion() {
    firebase
      .auth()
      .signOut()
      .then(() => {
        window.location.href = 'login.html';
      });
  },

  navegar(id) {
    const menuIds = [
      'reportetotal',
      'comanda',
      'cocina',
      'inventario',
      'pedidosweb',
    ];
    menuIds.forEach((m) => {
      const el = document.getElementById('v-' + m);
      if (el) el.style.display = m === id ? 'block' : 'none';
    });

    // Cerrar el modal si estaba abierto al cambiar de vista
    const modal = document.getElementById('modalMesa');
    if (modal && modal.style.display !== 'none') {
      this.cerrarMesa();
    }

    if (id === 'reportetotal') this.renderReporteDash();
    if (id === 'cocina') this.renderCocina();
    if (id === 'comanda') this.renderMesas();
    if (id === 'inventario') this.selectInventoryCat('hamburguesas');
    if (id === 'pedidosweb') this.renderPedidosWeb();
  },

  mostrarDashboardSegunModo() {
    const adminDashboard = document.querySelector('.admin-only-dashboard');
    const isMobile = window.innerWidth <= 768;

    if (!adminDashboard) return;

    if (this.modo === 'admin' || !isMobile) {
      // Mostrar dashboard para admin o en desktop
      adminDashboard.style.display = 'block';
    } else {
      // Ocultar dashboard para mesero en móvil
      adminDashboard.style.display = 'none';
    }
  },

  // --- GESTIÓN DE MESAS ---
  renderMesas() {
    const grid = document.getElementById('gridMesas');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 1; i <= 15; i++) this.crearBotonMesa(grid, i.toString());

    this.pendientes.forEach((p) => {
      if (isNaN(parseInt(p.mesa)) || parseInt(p.mesa) > 15)
        this.crearBotonMesa(grid, p.mesa);
    });

    const btnExtra = document.createElement('div');
    btnExtra.className = 'mesa-card libre';
    btnExtra.style.border = '2px dashed #ccc';
    btnExtra.innerHTML = `<b>+</b><br><small>Extra</small>`;
    btnExtra.onclick = () => {
      const m = prompt('Nombre/Número de mesa:');
      if (m) this.abrirMesa(m);
    };
    grid.appendChild(btnExtra);
  },
  //DE DJGV
  crearBotonMesa(contenedor, id) {
    const ocup = this.pendientes.find((p) => String(p.mesa) === String(id));
    const div = document.createElement('div');
    if (ocup) {
      div.className = 'mesa-card ocupada';
      div.innerHTML = `<br><b>MESA ${id}</b><br><small>${ocup.mesero}</small>`;
      div.onclick = () => this.abrirMesa(id);
    } else {
      div.className = 'mesa-card libre';
      div.innerHTML = `<br><b>MESA ${id}</b><br><small>Libre</small>`;
      div.onclick = () => this.abrirMesa(id);
    }
    contenedor.appendChild(div);
  },

  abrirMesa(n) {
    this.mesaAct = String(n);
    const ex = this.pendientes.find((p) => String(p.mesa) === String(n));
    this.carrito = ex ? JSON.parse(JSON.stringify(ex.items)) : [];
    this.meseroOriginal = ex ? ex.mesero : this.nombreUsuario;
    this.propinaActual = ex ? ex.propina || 0 : 0;

    document.getElementById('mesaNum').innerText = 'Mesa: ' + n;

    this.volverCategorias(); // Siempre iniciar en las categorías grandes

    document.getElementById('modalMesa').style.display = 'block';

    const inputLlevar = document.getElementById('cantLlevar');
    if (inputLlevar) inputLlevar.value = ex ? ex.cantLlevar || 0 : 0;

    this.renderCarrito();
  },

  abrirCategoria(c) {
    const cv = document.getElementById('categoriasView');
    const pv = document.getElementById('productosView');
    if (cv) cv.style.display = 'none';
    if (pv) pv.style.display = 'block';

    const titles = {
      hamburguesas: 'Hamburguesas',
      perros: 'Perros Calientes',
      salchipapas: 'Salchipapas',
      bebidas: 'Bebidas',
    };

    const tEl = document.getElementById('tituloCategoriaActual');
    if (tEl) tEl.innerText = titles[c] || 'Productos';

    this.setCat(c);
  },

  volverCategorias() {
    const cv = document.getElementById('categoriasView');
    const pv = document.getElementById('productosView');
    if (cv) cv.style.display = 'block';
    if (pv) pv.style.display = 'none';
  },

  parseMonto(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    // Limpieza profunda: eliminar $, puntos de miles, espacios
    const limpio = String(val).replace(/[$. ]/g, '').replace(',', '.');
    const num = parseFloat(limpio);
    return isNaN(num) ? 0 : num;
  },

  getFechaHoy() {
    const d = new Date();
    return d.toISOString().split('T')[0]; // YYYY-MM-DD (Universal)
  },

  setPropina(p) {
    this.propinaActual = p;
    this.actualizarTotal();
  },

  setPropinaMensaje() {
    const val = prompt('Ingrese monto exacto de propina en pesos (ej. 2000):');
    if (val && !isNaN(val)) {
      this.propinaActual = parseInt(val);
      this.actualizarTotal();
    }
  },

  // --- CARRITO Y PRODUCTOS ---
  // Subcategorías eliminadas temporalmente, se usarán 4 categorías principales directamente.

  setCat(c) {
    this.catActual = c;
    const tabsContainer = document.getElementById('subCategoryTabs');
    if (tabsContainer) tabsContainer.style.display = 'none';

    // Actualizar tab activo visualmente
    const tabs = ['hamburguesas', 'perros', 'salchipapas', 'bebidas'];
    tabs.forEach((tab) => {
      const el = document.getElementById(`tab-${tab}`);
      if (el) {
        if (tab === c) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });

    const cont = document.getElementById('listaItems');
    if (!cont) return;
    cont.innerHTML = '';

    this.productos
      .filter((p) => p.categoria === c)
      .forEach((p) => {
        const b = document.createElement('button');
        const cantEnCarrito = this.carrito.reduce(
          (sum, item) =>
            String(item.id) === String(p.id) ? sum + (item.cantidad || 1) : sum,
          0,
        );
        const stockDisponible = (p.stock || 0) - cantEnCarrito;
        const agotado = stockDisponible <= 0;

        b.className = agotado ? 'btn-agotado' : '';
        b.disabled = agotado;

        // Si el producto tiene imagen, usarla; si no, usar el icono genérico de categoría
        let imgHtml = '';
        if (p.imagen) {
          imgHtml = `<img src="${p.imagen}" style="width: 64px; height: 64px; object-fit: contain; display: block; margin: 0 auto 8px auto; background: #f8fafc; padding: 4px; border-radius: 8px;">`;
        } else {
          const iconUrl = this.iconMapping[p.categoria] || '';
          if (iconUrl) {
            imgHtml = `<img src="${iconUrl}" style="width: 48px; height: 48px; display: block; margin: 0 auto 8px auto;">`;
          }
        }

        const precioDisplay = this.parseMonto(p.precio).toLocaleString();
        b.innerHTML = `${imgHtml} ${p.nombre}<br>$${precioDisplay}${agotado ? '<br>AGOTADO' : '<br><small>Stock: ' + stockDisponible + '</small>'}`;
        b.onclick = () => {
          if (p.categoria === 'bebidas') {
            const itemExistente = this.carrito.find(
              (x) => String(x.id) === String(p.id),
            );
            if (itemExistente) {
              itemExistente.cantidad = (itemExistente.cantidad || 1) + 1;
            } else {
              this.carrito.push({
                ...p,
                uid: Date.now() + Math.random(),
                cantidad: 1,
                entregado: false,
              });
            }
          } else {
            this.carrito.push({
              ...p,
              uid: Date.now() + Math.random(),
              cantidad: 1,
              entregado: false,
            });
          }
          this.renderCarrito();
          this.setCat(c);
          this.notificar(`${p.nombre} agregado`);
        };
        cont.appendChild(b);
      });
  },

  renderCarrito() {
    const cont = document.getElementById('itemsCarrito');
    if (!cont) return;
    cont.innerHTML = '';

    this.carrito.forEach((i) => {
      const mostrarCant = ` x${i.cantidad || 1}`;
      let botonesCont = '';

      // Si el producto tiene imagen, usarla; si no, usar el icono genérico
      let imgHtml = '';
      if (i.imagen) {
        imgHtml = `<img src="${i.imagen}" style="width: 32px; height: 32px; object-fit: contain; background: #f8fafc; padding: 2px; border-radius: 4px; margin-right: 8px; vertical-align: middle;">`;
      } else {
        const iconUrl = this.iconMapping[i.categoria] || '';
        if (iconUrl) {
          imgHtml = `<img src="${iconUrl}" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;">`;
        }
      }

      if (i.categoria === 'bebidas') {
        botonesCont = `
            <button onclick="app.incrementarItem('${i.uid}')" class="btn-icon-sm"><i data-lucide="plus-circle"></i></button>
            <button onclick="app.decrementarItem('${i.uid}')" class="btn-icon-sm"><i data-lucide="minus-circle"></i></button>
            <button onclick="app.borrarItem('${i.uid}')" class="btn-icon-sm btn-danger-icon"><i data-lucide="trash-2"></i></button>`;
      } else {
        botonesCont = `
            <button onclick="app.decrementarItem('${i.uid}')" class="btn-icon-sm"><i data-lucide="minus-circle"></i></button>
            <button onclick="app.toggleListo('${i.uid}')" class="btn-icon-sm">${i.entregado ? '✅' : '<i data-lucide="chef-hat"></i>'}</button>
            <button onclick="app.borrarItem('${i.uid}')" class="btn-icon-sm btn-danger-icon"><i data-lucide="trash-2"></i></button>`;
      }

      cont.innerHTML += `
        <div class="item-car">
          <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
            ${imgHtml}
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${i.entregado ? 'text-decoration:line-through' : ''}">${i.nombre}${mostrarCant}</span>
          </div>
          <div style="flex-shrink: 0; margin-left: 10px;">
            ${botonesCont}
          </div>
        </div>`;
    });
    lucide.createIcons();
    this.actualizarTotal();
  },

  actualizarTotal() {
    let subtotal = 0;
    this.carrito.forEach((i) => {
      subtotal += this.parseMonto(i.precio) * (Number(i.cantidad) || 1);
    });
    const inputLlevar = document.getElementById('cantLlevar');
    const cantLlevar = inputLlevar ? Number(inputLlevar.value) || 0 : 0;
    subtotal += cantLlevar * 1000;

    let propinaMonto =
      this.propinaActual <= 1
        ? Math.round(subtotal * this.propinaActual)
        : this.propinaActual;

    const total = subtotal + propinaMonto;

    const subtEl = document.getElementById('subtotalMesa');
    const propEl = document.getElementById('propinaMesa');
    const totEl = document.getElementById('totalMesa');

    if (subtEl) subtEl.innerText = '$' + subtotal.toLocaleString();
    if (propEl) propEl.innerText = '$' + propinaMonto.toLocaleString();
    if (totEl) totEl.innerText = 'Total: $' + total.toLocaleString();

    this.totalActual = total; // Guardar valor numérico real
    this.updateChange();
  },

  incrementarLlevar() {
    document.getElementById('cantLlevar').value =
      (parseInt(document.getElementById('cantLlevar').value) || 0) + 1;
    this.actualizarTotal();
  },

  decrementarLlevar() {
    let v = (parseInt(document.getElementById('cantLlevar').value) || 0) - 1;
    document.getElementById('cantLlevar').value = v < 0 ? 0 : v;
    this.actualizarTotal();
  },

  decrementarItem(uid) {
    const i = this.carrito.find((x) => x.uid == uid);
    if (i) {
      i.cantidad = (i.cantidad || 1) - 1;
      if (i.cantidad <= 0) {
        this.borrarItem(uid);
      } else {
        this.renderCarrito();
      }
    }
  },
  //DE DJGV
  incrementarItem(uid) {
    const i = this.carrito.find((x) => x.uid == uid);
    if (i) {
      i.cantidad = (i.cantidad || 1) + 1;
      this.renderCarrito();
    }
  },

  toggleListo(uid) {
    const i = this.carrito.find((x) => x.uid == uid);
    if (i) {
      i.entregado = !i.entregado;
      this.renderCarrito();
      this.guardarPedido(true);
    }
  },

  borrarItem(uid) {
    this.carrito = this.carrito.filter((x) => x.uid != uid);
    this.renderCarrito();
    this.setCat(this.catActual);
  },

  guardarPedido(silencioso = false) {
    const tBase = this.carrito.reduce(
      (a, b) => a + b.precio * (b.cantidad || 1),
      0,
    );
    const cantLlevar =
      parseInt(document.getElementById('cantLlevar').value) || 0;
    const pago = document.getElementById('metodoPago').value;

    const subtotal = tBase + cantLlevar * 1000;
    const propinaMonto =
      this.propinaActual <= 1
        ? Math.round(subtotal * this.propinaActual)
        : this.propinaActual;
    const totalF = subtotal + propinaMonto;

    const hoy = new Date();
    const hoyString = this.getFechaHoy();

    const reg = {
      mesa: this.mesaAct,
      mesero: this.meseroOriginal,
      cobradoPor: pago ? this.nombreUsuario : '',
      items: this.carrito,
      total: totalF,
      subtotal: subtotal,
      propina: this.propinaActual,
      cantLlevar: cantLlevar,
      pago: pago || '',
      cashReceived: 0,
      change: 0,
      transferRef: '',
      fecha: hoy.toLocaleString(), // Mantenemos local para vista amigable
      fechaDia: hoyString, // Universal YYYY-MM-DD
      fechaCierre: pago ? hoy.toLocaleString() : '',
      timestamp: Date.now(),
    };

    if (pago) {
      if (pago === 'Efectivo') {
        const recibido =
          parseFloat(document.getElementById('cashReceived')?.value) || 0;
        if (recibido < reg.total) {
          alert('Monto insuficiente');
          return;
        }
        reg.cashReceived = recibido;
        reg.change = recibido - reg.total;
      } else if (pago === 'Transferencia') {
        reg.transferRef = document.getElementById('transferRef')?.value || '';
        reg.transferAmount =
          parseFloat(document.getElementById('transferAmount')?.value) ||
          reg.total;
      } else if (pago === 'Mixto') {
        const trAmt =
          parseFloat(document.getElementById('mixedTransferAmount')?.value) ||
          0;
        const cashRec =
          parseFloat(document.getElementById('mixedCashReceived')?.value) || 0;
        if (trAmt + cashRec < reg.total) {
          alert('Monto insuficiente');
          return;
        }
        reg.transferAmount = trAmt;
        reg.cashReceived = cashRec;
      }
      if (this.pagoEnProceso) {
        console.warn('Pago ya en proceso...');
        return;
      }
      this.procesarPagoAtomico(reg, silencioso);
    } else if (this.carrito.length > 0) {
      if (this.pagoEnProceso) return;
      this.pagoEnProceso = true;
      // Guardar como pendiente (nuevo documento o actualizar existente)
      const pedidoEx = this.pendientes.find(
        (p) => String(p.mesa) === String(this.mesaAct),
      );
      const docRef = pedidoEx
        ? this.negocioRef.collection('pedidos').doc(pedidoEx.id)
        : this.negocioRef.collection('pedidos').doc();

      docRef
        .set(reg, { merge: true })
        .then(() => {
          this.notificar('Pedido guardado');
          if (!silencioso) this.cerrarMesa();
        })
        .catch((err) => {
          console.error('Error guardando pedido:', err);
          alert('Error guardando pedido: ' + err);
        })
        .finally(() => {
          this.pagoEnProceso = false;
        });
    } else {
      alert('El carrito está vacío');
    }
  },

  async procesarPagoAtomico(reg, silencioso) {
    if (this.pagoEnProceso) {
      console.warn('Bloqueando doble pago...');
      return;
    }
    this.pagoEnProceso = true;
    try {
      const menuRef = this.negocioRef.collection('menu').doc('actual');
      const pedidoRef = this.pendientes.find(
        (p) => String(p.mesa) === String(reg.mesa),
      );
      const finalPedidoRef = pedidoRef
        ? this.negocioRef.collection('pedidos').doc(pedidoRef.id)
        : this.negocioRef.collection('pedidos').doc();

      await firebase.firestore().runTransaction(async (transaction) => {
        const menuDoc = await transaction.get(menuRef);
        if (!menuDoc.exists) throw 'Menú no encontrado!';

        const data = menuDoc.data();
        let productosServer = data.productos || [];

        // Validar stock
        reg.items.forEach((it) => {
          // Comparación robusta (código puede ser string o number)
          const p = productosServer.find((x) => String(x.id) === String(it.id));
          if (p && (p.stock || 0) < (it.cantidad || 1))
            throw `Stock insuficiente: ${it.nombre}`;
          if (p) p.stock = (p.stock || 0) - (it.cantidad || 1);
        });

        // Guardar pedido y actualizar stock en un solo paso atómico
        transaction.set(finalPedidoRef, reg, { merge: true });
        transaction.update(menuRef, { productos: productosServer });
      });

      console.log('✅ Pago procesado correctamente.');
      if (!silencioso) this.cerrarMesa();
    } catch (e) {
      console.error('❌ Error en transacción:', e);
      alert('Error: ' + e);
    } finally {
      this.pagoEnProceso = false;
    }
  },

  onPaymentMethodChange() {
    const metodo = document.getElementById('metodoPago').value;
    const efBox = document.getElementById('efectivoBox');
    const trBox = document.getElementById('transferBox');
    const mixedBox = document.getElementById('mixedBox');
    if (efBox) efBox.style.display = metodo === 'Efectivo' ? 'block' : 'none';
    if (trBox)
      trBox.style.display = metodo === 'Transferencia' ? 'block' : 'none';
    if (mixedBox)
      mixedBox.style.display = metodo === 'Mixto' ? 'block' : 'none';
    this.updateChange();
  },

  updateChange() {
    let total = this.totalActual || 0;

    const metodo = document.getElementById('metodoPago')?.value;
    if (metodo === 'Efectivo') {
      const recibido =
        parseFloat(document.getElementById('cashReceived')?.value) || 0;
      const cambio = Math.max(0, recibido - total);
      const changeEl = document.getElementById('changeDisplay');
      if (changeEl)
        changeEl.textContent = `Cambio: $${cambio.toLocaleString()}`;
    } else if (metodo === 'Transferencia') {
      // mostrar monto transferencia si existe (no hay cambio)
      const trAmt =
        parseFloat(document.getElementById('transferAmount')?.value) || 0;
      // opcional: podrías reflejar trAmt en algún elemento si quieres
    } else if (metodo === 'Mixto') {
      const trAmt =
        parseFloat(document.getElementById('mixedTransferAmount')?.value) || 0;
      const cashReceived =
        parseFloat(document.getElementById('mixedCashReceived')?.value) || 0;
      const cashPortion = Math.max(0, total - trAmt);
      const cambio = Math.max(0, cashReceived - cashPortion);
      const mixedChangeEl = document.getElementById('mixedChangeDisplay');
      if (mixedChangeEl)
        mixedChangeEl.textContent = `Cambio: $${cambio.toLocaleString()}`;
    } else {
      const changeEl = document.getElementById('changeDisplay');
      if (changeEl) changeEl.textContent = `Cambio: $0`;
      const mixedChangeEl = document.getElementById('mixedChangeDisplay');
      if (mixedChangeEl) mixedChangeEl.textContent = `Cambio: $0`;
    }
  },

  // --- REPORTE PDF PROFESIONAL ---
  async generarPDFReporte() {
    try {
      const selFecha = document.getElementById('fechaReporte')?.value;
      const esHoy = !selFecha || selFecha === this.getFechaHoy();
      const targetFecha = selFecha || this.getFechaHoy();

      const snapshot = await this.db
        .collection('negocios')
        .doc(this.negocioId)
        .collection('pedidos')
        .where('fechaDia', '==', targetFecha)
        .get();

      const orders = [];
      snapshot.forEach((doc) => orders.push(doc.data()));

      let tEfectivo = 0;
      let tTransfer = 0;
      let tGeneral = 0;
      let totalUnidadesVendidas = 0;
      let totalWebOrders = 0;
      const productosVendidos = {};

      orders.forEach((reg) => {
        // Solo contar pedidos que tengan un método de pago (cerrados)
        if (!reg.pago) return;

        if (reg.esWeb) totalWebOrders++;

        const totalNum = Number(reg.total) || 0;
        tGeneral += totalNum;

        if (reg.pago === 'Efectivo') tEfectivo += totalNum;
        else if (reg.pago === 'Transferencia') tTransfer += totalNum;
        else if (reg.pago === 'Mixto') {
          tTransfer += Number(reg.transferAmount) || 0;
          tEfectivo += Number(reg.cashReceived) || 0;
        }

        reg.items.forEach((it) => {
          const cant = Number(it.cantidad) || 1;
          totalUnidadesVendidas += cant;
          if (!productosVendidos[it.nombre]) {
            productosVendidos[it.nombre] = { cant: 0, categoria: it.categoria };
          }
          productosVendidos[it.nombre].cant += cant;
        });
      });

      const topProd = Object.entries(productosVendidos).sort(
        (a, b) => b[1].cant - a[1].cant,
      )[0];
      const topProdName = topProd ? topProd[0] : '-';
      const topProdQty = topProd ? topProd[1].cant : 0;
      const totalVentasRealizadas = orders.length;

      // 2. Construcción de HTML para impresión
      const businessName = 'Maxi wou wou';

      // Ajuste Hora Colombia
      const optionsDate = {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      };
      const optionsTime = {
        timeZone: 'America/Bogota',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      };

      // Si es hoy, usamos la hora actual. Si es pasado, solo la fecha.
      const now = new Date();
      const fechaDisplay = esHoy
        ? now.toLocaleDateString('es-CO', optionsDate)
        : targetFecha;
      const horaDisplay = esHoy
        ? now.toLocaleTimeString('es-CO', optionsTime)
        : '';

      let htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Reporte de Ventas - ${businessName}</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #334155; line-height: 1.6; padding: 40px; max-width: 800px; margin: auto; }
            .header { text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
            .header h1 { margin: 0; color: #1e293b; font-size: 24px; }
            .header p { margin: 5px 0; color: #64748b; font-size: 14px; }
            
            .section-title { font-size: 16px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #334155; margin: 30px 0 15px; padding-bottom: 5px; display: flex; align-items: center; gap: 8px; }
            
            .financial-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px; }
            .financial-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; text-align: center; }
            .financial-card.highlight { background: #1e293b; color: white; border-color: #1e293b; }
            .financial-card .label { font-size: 12px; font-weight: 600; margin-bottom: 5px; opacity: 0.8; }
            .financial-card .value { font-size: 18px; font-weight: 700; }
            .financial-card.highlight .value { font-size: 24px; }
            
            .summary-box { background: #f1f5f9; padding: 15px; border-radius: 8px; font-weight: 600; text-align: center; margin-bottom: 20px; }
            
            table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
            th { background: #f8fafc; text-align: left; padding: 10px; font-size: 13px; border-bottom: 2px solid #e2e8f0; }
            td { padding: 10px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
            .cat-header { background: #f1f5f9; font-weight: 700; color: #475569; }
            
            .indicators { display: flex; flex-direction: column; gap: 10px; background: #fff; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-top: 30px; }
            .indicator-item { display: flex; justify-content: space-between; }
            .indicator-item span:first-child { color: #64748b; }
            .indicator-item span:last-child { font-weight: 700; }
            
            .footer { margin-top: 50px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 20px; }
            @media print { .no-print { display: none; } body { padding: 0; } }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>${businessName}</h1>
            <p>Reporte de Ventas</p>
            <p>Fecha: ${fechaDisplay} ${horaDisplay ? '| Hora: ' + horaDisplay : ''}</p>
            <p>Tipo de reporte: ${esHoy ? 'Hoy (Cierre de caja)' : 'Histórico (' + targetFecha + ')'}</p>
        </div>

          <div class="section-title">RESUMEN FINANCIERO</div>
          <div class="financial-grid">
              <div class="financial-card">
                  <div class="label">Total Efectivo</div>
                  <div class="value">$${tEfectivo.toLocaleString()}</div>
              </div>
              <div class="financial-card">
                  <div class="label">Total Transferencia</div>
                  <div class="value">$${tTransfer.toLocaleString()}</div>
              </div>
              <div class="financial-card highlight">
                  <div class="label">TOTAL GENERAL</div>
                  <div class="value">$${tGeneral.toLocaleString()}</div>
              </div>
          </div>

          <div class="section-title">TOTAL PRODUCTOS VENDIDOS</div>
          <div class="summary-box">
              Total de productos vendidos: ${totalUnidadesVendidas} unidades
          </div>

          <div class="section-title">TABLA POR SECCIÓN</div>
          <table>
              <thead>
                  <tr>
                      <th>Producto</th>
                      <th style="text-align: right;">Cantidad Vendida</th>
                  </tr>
              </thead>
              <tbody>
      `;

      const categories = [
        { id: 'hamburguesas', label: 'Sección Hamburguesas' },
        { id: 'perros', label: 'Sección Perros' },
        { id: 'salchipapas', label: 'Sección Salchipapas' },
        { id: 'bebidas', label: 'Sección Bebidas' },
        { id: 'otros', label: 'Otros' },
      ];

      categories.forEach((cat) => {
        const catProds = Object.entries(productosVendidos).filter(
          ([name, data]) => data.categoria === cat.id,
        );
        if (catProds.length > 0) {
          htmlContent += `<tr class="cat-header"><td colspan="2">${cat.label}</td></tr>`;
          catProds.forEach(([name, data]) => {
            htmlContent += `
              <tr>
                  <td>${name}</td>
                  <td style="text-align: right;">${data.cant}</td>
              </tr>
            `;
          });
        }
      });

      htmlContent += `
              </tbody>
          </table>

          <div class="section-title">INDICADORES FINALES</div>
          <div class="indicators">
              <div class="indicator-item">
                  <span>Total de ventas realizadas</span>
                  <span>${totalVentasRealizadas}</span>
              </div>
              <div class="indicator-item" style="color: #10b981;">
                  <span>Ventas provenientes de Pedidos Web</span>
                  <span>${totalWebOrders}</span>
              </div>
              <div class="indicator-item">
                  <span>Producto más vendido</span>
                  <span>${topProdName}</span>
              </div>
              <div class="indicator-item">
                  <span>Cant. vendida del producto más vendido</span>
                  <span>${topProdQty}</span>
              </div>
          </div>

          <div class="footer">
              <p>Reporte generado automáticamente por el sistema ${businessName}</p>
              <p>${fechaDisplay} - ${horaDisplay} | Página 1 de 1</p>
          </div>
      </body>
      </html>
      `;

      const reportWindow = window.open('', '', 'width=900,height=800');
      reportWindow.document.write(htmlContent);
      reportWindow.document.close();

      setTimeout(() => {
        reportWindow.print();
      }, 500);
    } catch (error) {
      console.error('Error al generar PDF:', error);
      alert('Hubo un error al generar el reporte.');
    }
  },

  renderVentas() {
    const lista = document.getElementById('listaVentas');
    if (!lista) return;

    const selFecha =
      document.getElementById('fechaReporte')?.value || this.getFechaHoy();
    const historialFiltrado = this.historial.filter(
      (v) => v.fechaDia === selFecha,
    );

    if (historialFiltrado.length === 0) {
      lista.innerHTML =
        '<div style="text-align:center; padding:20px; color:#999;">Sin transacciones para esta fecha</div>';
      return;
    }

    lista.innerHTML = historialFiltrado
      .map((v, idx) => {
        // Agrupar productos por nombre (sumar cantidades iguales)
        const productosAgrupados = {};
        v.items.forEach((item) => {
          if (!productosAgrupados[item.nombre]) {
            productosAgrupados[item.nombre] = {
              nombre: item.nombre,
              cantidad: 0,
            };
          }
          productosAgrupados[item.nombre].cantidad += item.cantidad || 1;
        });

        const productsHTML = Object.values(productosAgrupados)
          .map(
            (item) => `
          <div style="background: #f0fdf4; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #10b981;">
            <div style="font-weight: 500; color: #334155;">${item.nombre}</div>
            <div style="font-size: 0.85rem; color: #64748b;">x${item.cantidad}</div>
          </div>
        `,
          )
          .join('');

        return `
        <div class="transaction-item" style="cursor: pointer;" onclick="app.toggleDetalleVenta(${idx})">
          <div class="transaction-info">
            <div class="transaction-main">Mesa ${v.mesa} - Mesero: ${v.mesero}</div>
            <div class="transaction-details">
              ${v.cobradoPor ? 'Cobrado por: ' + v.cobradoPor + ' | ' : ''}
              ${v.fechaDia === this.getFechaHoy() ? 'Hoy' : v.fechaDia} | ${v.fecha.split(',')[1] || v.fecha}
            </div>
          </div>
          <div class="transaction-amount">
            <div class="transaction-total">$${(v.total || 0).toLocaleString()}</div>
            <div class="transaction-method ${v.pago ? v.pago.toLowerCase() : 'pendiente'}">
              ${v.pago || 'Pendiente'}
            </div>
          </div>
          <div class="transaction-products" id="detalleVenta-${idx}" style="display: none; grid-column: 1 / -1; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.1);">
            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:8px;">
              <div style="font-weight:600; color:#334155;">Productos:</div>
              <div style="color:#64748b;">Empaques llevar: <strong>${v.cantLlevar || 0}</strong></div>
              ${(v.pago === 'Efectivo' || v.pago === 'Mixto') && typeof v.cashReceived !== 'undefined' ? `<div style="color:#64748b;">Recibido: <strong>$${(v.cashReceived || 0).toLocaleString()}</strong></div>` : ''}
              ${typeof v.change !== 'undefined' && v.change !== null ? `<div style="color:#0f172a;">Cambio: <strong>$${(v.change || 0).toLocaleString()}</strong></div>` : ''}
              ${(v.pago === 'Transferencia' || v.pago === 'Mixto') && typeof v.transferAmount !== 'undefined' ? `<div style="color:#64748b;">Transferencia: <strong>$${(v.transferAmount || 0).toLocaleString()}</strong></div>` : ''}
              ${(v.pago === 'Transferencia' || v.pago === 'Mixto') && v.transferRef ? `<div style="color:#64748b;">Referencia: <strong>${v.transferRef}</strong></div>` : ''}
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
              ${productsHTML}
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  },

  toggleDetalleVenta(idx) {
    const detalleEl = document.getElementById(`detalleVenta-${idx}`);
    if (detalleEl) {
      const isVisible = detalleEl.style.display !== 'none';
      detalleEl.style.display = isVisible ? 'none' : 'grid';
    }
  },

  renderCocina() {
    const cont = document.getElementById('listaCocina');
    if (!cont) return;

    // Agrupar órdenes por mesa
    const gruposPorMesa = {};

    this.pendientes.forEach((p) => {
      if (!gruposPorMesa[p.mesa]) {
        gruposPorMesa[p.mesa] = {
          mesa: p.mesa,
          mesero: p.mesero,
          fecha: p.fecha,
          comidas: {}, // Será {nombreProducto: cantidad}
        };
      }

      p.items
        .filter(
          (it) =>
            !it.entregado &&
            ['hamburguesas', 'perros', 'salchipapas'].includes(it.categoria),
        )
        .forEach((it) => {
          if (!gruposPorMesa[p.mesa].comidas[it.nombre]) {
            gruposPorMesa[p.mesa].comidas[it.nombre] = 0;
          }
          gruposPorMesa[p.mesa].comidas[it.nombre] += it.cantidad || 1;
        });
    });

    // Renderizar bloque por mesa
    cont.innerHTML = Object.values(gruposPorMesa)
      .map((grupo) => {
        const comidasList = Object.entries(grupo.comidas)
          .map(
            ([nombre, cantidad]) =>
              `<div style="padding:8px 0; font-size:1.1em;"> ${nombre} <strong>x${cantidad}</strong></div>`,
          )
          .join('');

        return `
      <div class="cocina-card" style="margin-bottom:15px; padding:15px; background:white; border-left:5px solid #1a3c40; border-radius:10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div>
          <b style="font-size:1.2em; display:block; margin-bottom:10px;">MESA ${grupo.mesa}</b>
          ${comidasList}
          <small style="color:#666; display:block; margin-top:10px;">${grupo.mesero} | ${grupo.fecha.split(',')[1]}</small>
        </div>
      </div>
    `;
      })
      .join('');
  },

  renderListaEdicion() {
    const cont = document.getElementById('listaEdicion');
    if (!cont) return;
    cont.innerHTML =
      '<h3>Inventario</h3>' +
      this.productos
        .map(
          (p) => `
      <div class="edit-prod" style="display:flex; justify-content:space-between; background:white; padding:10px; margin-bottom:5px; border-radius:10px;">
        <span>${p.nombre}</span>
        <div>
          Stock: <input type="number" value="${p.stock || 0}" onchange="app.ajStock(${p.id}, this.value)" style="width:50px">
          <button onclick="app.eliminarItem(${p.id})">Eliminar</button>
        </div>
      </div>`,
        )
        .join('');
  },

  renderPedidosWeb() {
    const cont = document.getElementById('listaPedidosWeb');
    if (!cont) return;

    if (this.pedidosWeb.length === 0) {
      cont.innerHTML =
        '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#94a3b8;"><i data-lucide="inbox" style="width:48px;height:48px;margin-bottom:10px;"></i><br>No hay pedidos web pendientes.</div>';
      if (window.lucide) lucide.createIcons();
      return;
    }

    cont.innerHTML = this.pedidosWeb
      .map((p) => {
        const obs = (p.items || [])
          .map(
            (i) =>
              `<div><span style="font-weight:bold; color:var(--primary);">${i.cantidad}x</span> ${i.nombre}</div>`,
          )
          .join('');
        const phoneStr = p.whatsapp
          ? `<a href="https://wa.me/57${p.whatsapp}" target="_blank" style="color:#10b981; font-weight:bold; display:flex; align-items:center; gap:5px; text-decoration:none;"><i data-lucide="phone" style="width:16px; height:16px;"></i> ${p.whatsapp}</a>`
          : '';

        return `
        <div class="card" style="border-left: 4px solid #10b981; margin: 0; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <div style="font-size:0.8rem; color:#64748b; font-weight:bold;">TICKET <span style="font-size:1.1rem; color:var(--primary); display:block;">${p.idExterno || 'WEB-XXX'}</span></div>
            <span style="background:#f1f5f9; padding:4px 8px; border-radius:4px; font-size:0.8rem; font-weight:bold; color:#475569;">${p.metodoPago || 'Efectivo'}</span>
          </div>
          <div style="margin-bottom: 15px; font-size:0.95rem;">
            <div style="color:#334155; margin-bottom:5px;"><strong>Cliente:</strong> ${p.nombre}</div>
            ${phoneStr}
            <div style="color:#64748b; font-size:0.8rem; margin-top:5px;">Hace unos instantes...</div>
          </div>
          
        <div style="font-weight:bold; color:#334155; margin-bottom:5px; font-size:0.9rem;">Orden:</div>
        <div style="background:#f8fafc; padding:10px; border-radius:8px; margin-bottom:10px; font-size:0.9rem; flex:1;">
          ${obs}
        </div>
        
        ${
          p.nota && p.nota.trim() !== ''
            ? `
          <div style="background: #FFFBEB; border-left: 4px solid #F5C518; padding: 10px 14px; margin-bottom: 15px; border-radius: 4px;">
            <div style="font-weight:bold; color:#92400e; margin-bottom:4px; font-size:0.85rem;">📝 NOTA:</div>
            <div style="color: #451a03; font-style: italic; font-size: 0.9rem;">${p.nota}</div>
          </div>
        `
            : ''
        }
          
          <div style="display:flex; justify-content:space-between; align-items:flex-end; border-top: 1px solid #e2e8f0; padding-top:15px; gap:8px; flex-wrap:wrap;">
             <div>
               <span style="display:block; font-size:0.75rem; color:#64748b; font-weight:bold; uppercase;">TOTAL</span>
               <span style="font-size:1.3rem; font-weight:900; color:var(--primary);">$${(p.total || 0).toLocaleString()}</span>
             </div>
             <div style="display:flex; gap:6px; flex-shrink:0;">
               <button class="btn btn-primary" onclick="app.completarPedidoWeb('${p.id}')" style="border-radius:6px; display:flex; align-items:center; gap:4px; font-size:0.9rem; padding:7px 12px; white-space:nowrap;">
                 <i data-lucide="check-circle" style="width:14px; height:14px;"></i> Completar
               </button>
               <button class="btn btn-danger-icon" onclick="app.eliminarPedidoWeb('${p.id}')" style="border-radius:6px; display:flex; align-items:center; gap:4px; background:#ef4444; color:white; border:none; padding:7px 10px; font-size:0.9rem; white-space:nowrap; flex-shrink:0;">
                 <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Eliminar
               </button>
             </div>
          </div>
        </div>
       `;
      })
      .join('');

    if (window.lucide) lucide.createIcons();
  },

  async completarPedidoWeb(docId) {
    if (
      !confirm(
        '¿Marcar este pedido web como completado e ingresarlo a las ventas del día?',
      )
    )
      return;

    // Find doc ID ensuring we have a match
    const pedido = this.pedidosWeb.find((x) => x.id === docId);
    if (!pedido) return;

    const hoy = new Date();
    const hoyString = this.getFechaHoy();

    // Format required for 'pedidos' daily log
    const regCaja = {
      mesa: 'WEB', // Represents Web Source
      mesero: 'Auto',
      cobradoPor: this.nombreUsuario || 'Admin',
      items: pedido.items,
      total: pedido.total || 0,
      subtotal: pedido.total || 0,
      propina: 0,
      cantLlevar: 0,
      pago: pedido.metodoPago || 'Efectivo',
      cashReceived: pedido.metodoPago === 'Efectivo' ? pedido.total || 0 : 0,
      change: 0,
      transferRef: pedido.idExterno || '',
      transferAmount:
        pedido.metodoPago === 'Transferencia' ? pedido.total || 0 : 0,
      fecha: hoy.toLocaleString(),
      fechaDia: hoyString,
      fechaCierre: hoy.toLocaleString(),
      timestamp: Date.now(),
      esWeb: true,
    };

    try {
      await this.negocioRef.collection('pedidos').add(regCaja);
      const extRef = firebase
        .firestore()
        .collection('pedidos_externos')
        .doc(docId);
      await extRef.update({ estado: 'completado' });
      this.notificar('✅ Pedido WEB ingresado a caja correctamente.');
    } catch (e) {
      console.error('Error al completar pedido web:', e);
      alert('Hubo un error completando el pedido web: ' + e.message);
    }
  },

  async eliminarPedidoWeb(docId) {
    if (
      !confirm(
        '⚠️ ¿Estás seguro de que deseas ELIMINAR este pedido web? Se perderá toda la información del pedido.',
      )
    )
      return;

    const password = prompt(
      'Para eliminar el pedido, ingresa tu contraseña de administrador:',
    );
    if (!password) return;

    try {
      const email = firebase.auth().currentUser?.email;
      if (!email) {
        alert('Error: No hay usuario logueado');
        return;
      }

      // Validar contraseña reautenticando
      await firebase.auth().signInWithEmailAndPassword(email, password);

      // Contraseña correcta, proceder con eliminación
      const extRef = firebase
        .firestore()
        .collection('pedidos_externos')
        .doc(docId);

      await extRef.delete();
      this.notificar('✅ Pedido WEB eliminado correctamente.');
      this.renderPedidosWeb(); // Actualizar lista
    } catch (e) {
      console.error('Error:', e);
      alert('❌ Contraseña incorrecta o error al eliminar el pedido');
    }
  },

  ajStock(id, v) {
    const stockValue = parseInt(v, 10);
    if (isNaN(stockValue) || stockValue < 0) {
      alert('Ingrese un valor válido');
      return;
    }
    const p = this.productos.find((x) => x.id === id);
    if (p) {
      p.stock = stockValue;
      this.negocioRef
        .collection('menu')
        .doc('actual')
        .set({ productos: this.productos }, { merge: true });
    }
  },

  crearItem(categoria) {
    let n = document.getElementById(`newNombre${categoria}`)?.value;
    let p = parseInt(document.getElementById(`newPrecio${categoria}`)?.value);

    if (!n || !p) return alert('Nombre y precio requeridos');
    this.productos.push({
      id: Date.now(),
      nombre: n,
      precio: p,
      categoria: categoria,
      stock: 50,
    });
    this.negocioRef
      .collection('menu')
      .doc('actual')
      .set({ productos: this.productos }, { merge: true });

    if (document.getElementById(`newNombre${categoria}`)) {
      document.getElementById(`newNombre${categoria}`).value = '';
    }
    if (document.getElementById(`newPrecio${categoria}`)) {
      document.getElementById(`newPrecio${categoria}`).value = '';
    }

    alert('✅ Producto creado correctamente');
    this.renderInventarioDash();
  },

  eliminarItem(id) {
    if (confirm('⚠️ ¿Eliminar producto?')) {
      const idStr = String(id); // Ensure ID is string for comparison
      this.productos = this.productos.filter((p) => String(p.id) !== idStr);
      this.negocioRef
        .collection('menu')
        .doc('actual')
        .set({ productos: this.productos }, { merge: true });
      this.renderInventarioDash(); // Recarga el inventario
      if (this.currentInvCat) this.renderInventoryList(this.currentInvCat);
      this.notificar('✅ Producto eliminado');
    }
  },

  // --- VALIDACIÓN DE SEGURIDAD ELIMINADA ---

  ajStockSeguro(id, v) {
    const idStr = String(id);
    const p = this.productos.find((x) => String(x.id) === idStr);
    if (p) {
      p.stock = (p.stock || 0) + v;
      if (p.stock < 0) p.stock = 0;
      this.negocioRef
        .collection('menu')
        .doc('actual')
        .set({ productos: this.productos }, { merge: true });
    }
  },

  ajPrecioSeguro(id, v) {
    const idStr = String(id);
    const p = this.productos.find((x) => String(x.id) === idStr);
    if (p) {
      const newPrice = parseInt(v);
      if (!isNaN(newPrice) && newPrice >= 0) {
        p.precio = newPrice;
        this.negocioRef
          .collection('menu')
          .doc('actual')
          .set({ productos: this.productos }, { merge: true });
        this.renderInventarioDash();
        if (this.currentInvCat) this.renderInventoryList(this.currentInvCat);
        this.notificar('✅ Precio actualizado');
      }
    }
  },

  ajNombreSeguro(id, v) {
    const idStr = String(id);
    const p = this.productos.find((x) => String(x.id) === idStr);
    if (p && v.trim() !== '') {
      p.nombre = v.trim();
      this.negocioRef
        .collection('menu')
        .doc('actual')
        .set({ productos: this.productos }, { merge: true });
      this.renderInventarioDash();
      if (this.currentInvCat) this.renderInventoryList(this.currentInvCat);
      this.notificar('✅ Nombre actualizado');
    }
  },

  crearItemSeguro(categoria = 'comida') {
    this.crearItem(categoria);
  },

  async limpiarReporteSeguro() {
    if (
      confirm(
        `¿Desea reiniciar el stock? (Los pedidos se conservan en la base de datos)`,
      )
    ) {
      if (confirm('¿Desea reiniciar el stock de todos los productos a 50?')) {
        this.productos.forEach((p) => (p.stock = 50));
        await this.negocioRef
          .collection('menu')
          .doc('actual')
          .update({ productos: this.productos });
        this.notificar('Stock reiniciado');
      }
      this.renderReporteDash();
    }
  },

  async purgarHistorialTotal() {
    if (
      !confirm(
        '⚠️ ADVERTENCIA CRÍTICA: ¿Desea eliminar TODO el historial de ventas? Esto es irreversible.',
      )
    )
      return;
    if (
      !confirm(
        '¿Está absolutamente seguro(a)? Se borrarán todos los registros de pedidos cerrados.',
      )
    )
      return;

    try {
      this.notificar('Iniciando purga...');
      const snapshot = await this.negocioRef
        .collection('pedidos')
        .where('fechaCierre', '!=', '')
        .get();

      const batch = this.db.batch();
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      this.historial = [];
      this.renderReporteDash();
      this.notificar('Historial purgado con éxito');
    } catch (e) {
      console.error(e);
      alert('Error al purgar historial: ' + e);
    }
  },

  // --- DASHBOARD MODERNO ---
  renderReporteDash() {
    const selFecha =
      document.getElementById('fechaReporte')?.value || this.getFechaHoy();

    // Filtrar historial por la fecha seleccionada
    const historialFiltrado = this.historial.filter(
      (v) => v.fechaDia === selFecha,
    );

    // Calcular estadísticas
    let tDinero = 0;
    let totalPedidos = historialFiltrado.length;
    let productosVendidos = {};

    historialFiltrado.forEach((v) => {
      if (!v || !v.items) return;
      tDinero += v.total || 0;
      v.items.forEach((it) => {
        if (!productosVendidos[it.nombre]) {
          productosVendidos[it.nombre] = {
            cantidad: 0,
            precio: it.precio,
            total: 0,
          };
        }
        productosVendidos[it.nombre].cantidad += it.cantidad || 1;
        productosVendidos[it.nombre].total += it.precio * (it.cantidad || 1);
      });
    });

    const ticketPromedio = totalPedidos > 0 ? tDinero / totalPedidos : 0;

    // Encontrar producto más vendido
    let topProd = '-';
    let maxCant = 0;
    Object.entries(productosVendidos).forEach(([nombre, data]) => {
      if (data.cantidad > maxCant) {
        maxCant = data.cantidad;
        topProd = nombre;
      }
    });

    // Actualizar KPIs con animación
    this.animateValue('kpi-ventas', 0, tDinero, 1000, true);
    this.animateValue('kpi-pedidos', 0, totalPedidos, 1000);
    this.animateValue('kpi-ticket', 0, ticketPromedio, 1000, true);
    const topProdEl = document.getElementById('kpi-top-prod');
    if (topProdEl) topProdEl.innerText = topProd;

    // Renderizar Secciones
    this.renderTopProducts(productosVendidos);
    this.renderInventorySummary();
    this.renderGrafico();

    // Siempre renderizar el historial de ventas (el historial completo se mantiene en la lista pero el dashboard se filtra)
    this.renderVentas();
  },

  animateValue(id, start, end, duration, formatCurrency = false) {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const val = Math.floor(progress * (end - start) + start);
      obj.innerText = formatCurrency
        ? '$' + val.toLocaleString()
        : val.toLocaleString();
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  },

  renderTopProducts(productosVendidos) {
    const container = document.getElementById('top-products-list');
    if (!container) return;

    const top5 = Object.entries(productosVendidos)
      .sort((a, b) => b[1].cantidad - a[1].cantidad)
      .slice(0, 5);

    const totalVendidos = Object.values(productosVendidos).reduce(
      (acc, p) => acc + p.cantidad,
      0,
    );

    container.innerHTML = top5
      .map(([nombre, data], index) => {
        const percentage =
          totalVendidos > 0 ? (data.cantidad / totalVendidos) * 100 : 0;
        return `
        <div class="progress-container">
          <div class="progress-header">
            <span>${index + 1}. ${nombre}</span>
            <span style="font-weight: 700;">${data.cantidad} vendidos</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: 0%;" data-width="${percentage}%"></div>
          </div>
        </div>
      `;
      })
      .join('');

    // Animate progress bars
    setTimeout(() => {
      container.querySelectorAll('.progress-bar-fill').forEach((bar) => {
        bar.style.width = bar.dataset.width;
      });
    }, 100);
  },

  renderInventorySummary() {
    const container = document.getElementById('inventory-summary-list');
    if (!container) return;

    container.innerHTML = this.productos
      .slice(0, 10)
      .map((p) => {
        return `
        <div class="summary-item-card">
          <div class="summary-item-name">${p.nombre}</div>
          <div class="summary-item-stock" style="background: transparent; color: var(--dashboard-text); font-weight: 700;">
            ${p.stock || 0}
          </div>
        </div>
      `;
      })
      .join('');

    if (this.productos.length > 10) {
      container.innerHTML += `<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-size: 0.8rem; padding-top: 10px;">Visualizando los primeros 10 productos...</div>`;
    }
  },

  switchSalesTab(categoria) {
    const tabs = ['hamburguesas', 'perros', 'salchipapas', 'bebidas'];
    tabs.forEach((tab) => {
      const section = document.getElementById(`sales-${tab}-section`);
      const btn = document.getElementById(`tab-sales-${tab}`);
      if (section) section.classList.remove('active');
      if (btn) btn.classList.remove('active');

      if (tab === categoria) {
        if (section) section.classList.add('active');
        if (btn) btn.classList.add('active');
      }
    });
  },

  switchInventoryTab(categoria) {
    this.selectInventoryCat(categoria);
  },

  async limpiarHistorialDia() {
    const password = prompt(
      'Para limpiar el historial del día, ingresa tu contraseña de administrador:',
    );
    if (!password) return;

    try {
      const email = firebase.auth().currentUser.email;
      // Intentar validar contraseña re-autenticando (usando signIn para verificar)
      await firebase.auth().signInWithEmailAndPassword(email, password);

      if (
        !confirm(
          '¿Estás SEGURO de que deseas borrar TODAS las ventas de hoy? Esta acción no se puede deshacer.',
        )
      )
        return;

      const hoy = this.getFechaHoy();
      const snapshot = await this.db
        .collection('negocios')
        .doc(this.negocioId)
        .collection('pedidos')
        .where('fechaDia', '==', hoy)
        .get();

      if (snapshot.empty) {
        alert('No hay ventas registradas hoy.');
        return;
      }

      const batch = this.db.batch();
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      this.notificar('Historial del día limpiado con éxito.');
    } catch (e) {
      console.error('Error al limpiar historial:', e);
      alert('Contraseña incorrecta o error de permisos: ' + e.message);
    }
  },

  // --- GRÁFICOS MODERNOS CON TABS ---
  setChartMode(mode, btn) {
    this.chartMode = mode;
    this.chartSubMode = null;

    // UI Update
    if (btn) {
      const parent = btn.parentElement;
      parent
        .querySelectorAll('.chart-tab-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    }

    this.renderChartSubTabs();
    this.renderGrafico();
  },

  renderChartSubTabs() {
    const container = document.getElementById('chart-sub-tabs');
    if (!container) return;
    container.innerHTML = '';

    let options = [];
    if (this.chartMode === 'money') {
      options = ['Efectivo', 'Transferencia'];
    } else if (this.chartMode === 'products') {
      options = ['Hamburguesas', 'Perros', 'Salchipapas', 'Bebidas'];
    } else if (this.chartMode === 'payments') {
      options = ['Efectivo', 'Transferencia'];
    }

    if (!this.chartSubMode) this.chartSubMode = options[0];

    container.innerHTML = options
      .map(
        (opt) => `
        <button class="chart-tab-btn ${this.chartSubMode === opt ? 'active' : ''}" 
                style="font-size: 0.75rem; padding: 6px 12px;"
                onclick="app.setChartSubMode('${opt}', this)">
            ${opt}
        </button>
    `,
      )
      .join('');
  },

  setChartSubMode(sub, btn) {
    this.chartSubMode = sub;
    if (btn) {
      btn.parentElement
        .querySelectorAll('.chart-tab-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    }
    this.renderGrafico();
  },

  renderGrafico() {
    const canvas = document.getElementById('analysisChart');
    if (!canvas) return;

    if (window.analysisChart instanceof Chart) {
      window.analysisChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    const mode = this.chartMode || 'money';
    const sub = this.chartSubMode;

    const labelDays = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ];
    let datasets = [];

    // Real data calculation
    const salesByDay = [0, 0, 0, 0, 0, 0, 0]; // Mon to Sun
    const paymentsEfeByDay = [0, 0, 0, 0, 0, 0, 0];
    const paymentsTraByDay = [0, 0, 0, 0, 0, 0, 0];
    const productsByDay = [0, 0, 0, 0, 0, 0, 0];

    const selFecha =
      document.getElementById('fechaReporte')?.value || this.getFechaHoy();

    // Si queremos que el gráfico muestre la semana, usamos this.historial.
    // Pero si el usuario dice que "no limpia", igual quiere que el gráfico también se vea afectado?
    // Generalmente para gráficos se prefiere ver la tendencia, pero si el dashboard es "específico del día",
    // quizás deberíamos mostrar la semana centrada o hasta ese día.

    this.historial.forEach((v) => {
      // Filtrar por mes actual o semana actual para que el gráfico tenga sentido
      // Por ahora mantendremos el comportamiento de los últimos 7 días que trae el listener
      const d = new Date(v.fechaDia + 'T00:00:00');
      let dayIdx = d.getDay() - 1; // 0=Mon, 6=Sun
      if (dayIdx === -1) dayIdx = 6; // Sunday fix

      if (mode === 'money') {
        if (v.pago === 'Efectivo') paymentsEfeByDay[dayIdx] += v.total || 0;
        else if (v.pago === 'Transferencia')
          paymentsTraByDay[dayIdx] += v.total || 0;
        else if (v.pago === 'Mixto') {
          paymentsEfeByDay[dayIdx] += v.cashReceived || 0;
          paymentsTraByDay[dayIdx] += v.transferAmount || 0;
        }
      } else if (mode === 'products' && sub) {
        v.items.forEach((it) => {
          if (it.categoria.toLowerCase() === sub.toLowerCase()) {
            productsByDay[dayIdx] += it.cantidad || 1;
          }
        });
      }
    });

    if (mode === 'money') {
      const subTabs = document.getElementById('chart-sub-tabs');
      if (subTabs) subTabs.style.display = 'none';

      const gradEfe = ctx.createLinearGradient(0, 0, 0, 400);
      gradEfe.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
      gradEfe.addColorStop(1, 'rgba(16, 185, 129, 0)');

      const gradTra = ctx.createLinearGradient(0, 0, 0, 400);
      gradTra.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
      gradTra.addColorStop(1, 'rgba(59, 130, 246, 0)');

      datasets = [
        {
          label: 'Efectivo',
          data: paymentsEfeByDay,
          borderColor: '#10b981',
          backgroundColor: gradEfe,
          fill: true,
          tension: 0.4,
        },
        {
          label: 'Transferencia',
          data: paymentsTraByDay,
          borderColor: '#3b82f6',
          backgroundColor: gradTra,
          fill: true,
          tension: 0.4,
        },
      ];
    } else {
      const subTabs = document.getElementById('chart-sub-tabs');
      if (subTabs) subTabs.style.display = 'flex';

      const gradient = ctx.createLinearGradient(0, 0, 0, 400);
      gradient.addColorStop(0, 'rgba(81, 99, 115, 0.4)');
      gradient.addColorStop(1, 'rgba(81, 99, 115, 0)');

      datasets = [
        {
          label: sub || mode,
          data: productsByDay,
          borderColor: '#516373',
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
        },
      ];
    }

    window.analysisChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labelDays,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: mode === 'money' },
          tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#f8fafc',
            bodyColor: '#333',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function (context) {
                return (
                  (mode === 'money' ? '$' : '') +
                  context.parsed.y.toLocaleString()
                );
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: {
              callback: function (value) {
                return (mode === 'money' ? '$' : '') + value.toLocaleString();
              },
            },
          },
          x: { grid: { display: false } },
        },
      },
    });
  },

  // --- MODAL INVENTARIO ---
  abrirModalInventario() {
    const modal = document.getElementById('modal-inventario');
    if (modal) {
      modal.classList.add('active');
      this.volverACategoriasInv();
      lucide.createIcons();
    }
  },

  cerrarModalInventario() {
    const modal = document.getElementById('modal-inventario');
    if (modal) modal.classList.remove('active');
  },

  selectInventoryCat(cat) {
    this.currentInvCat = cat;
    // Actualizar estados visuales de los tabs
    document.querySelectorAll('.inventory-tab-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
    const activeTab = document.getElementById('tab-inv-' + cat);
    if (activeTab) activeTab.classList.add('active');

    const title = {
      hamburguesas: 'Hamburguesas',
      perros: 'Perros Calientes',
      salchipapas: 'Salchipapas/Papas',
      bebidas: 'Bebidas y Sodas',
      otros: 'Otros Productos',
    };
    const titleEl = document.getElementById('inventory-list-title-main');
    if (titleEl) titleEl.innerText = title[cat] || ' Productos';

    this.renderInventoryList(cat);
    lucide.createIcons();
  },

  renderInventoryList(cat) {
    const container = document.getElementById('inventory-list-container-main');
    if (!container) return;
    container.innerHTML = '';

    const list = this.productos.filter((p) => {
      const pCat = String(p.categoria || 'hamburguesas').toLowerCase();
      const targetCat = cat.toLowerCase();

      const mainCats = ['hamburguesas', 'perros', 'salchipapas', 'bebidas'];
      let normalizedPCat = pCat;
      if (pCat.includes('hamburguesa')) normalizedPCat = 'hamburguesas';
      if (pCat.includes('perro')) normalizedPCat = 'perros';
      if (pCat.includes('papas') || pCat.includes('salchipapa'))
        normalizedPCat = 'salchipapas';
      if (
        pCat.includes('bebida') ||
        pCat.includes('soda') ||
        pCat.includes('jugo')
      )
        normalizedPCat = 'bebidas';

      if (targetCat === 'otros') return !mainCats.includes(normalizedPCat);
      return normalizedPCat === targetCat;
    });

    if (list.length === 0) {
      container.innerHTML =
        '<p style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b;">No hay productos en esta categoría.</p>';
      return;
    }

    list.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'inventory-item-card';

      const precioDisp = Number(p.precio).toLocaleString();
      const stockStatus = p.stock < 10 ? 'low-stock' : 'normal-stock';

      // Miniatura de imagen
      const thumbHtml = p.imagen
        ? `<img src="${p.imagen}" alt="foto" style="width:100%; height:80px; object-fit:contain; background:#f8fafc; border-radius:8px; margin-bottom:8px;">`
        : `<div style="width:100%; height:60px; border-radius:8px; margin-bottom:8px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-size:0.72rem; color:#94a3b8; font-weight:700;">SIN FOTO</div>`;

      item.innerHTML = `
        ${thumbHtml}
        <div class="inventory-item-header">
           <h4 class="inventory-item-name">${p.nombre}</h4>
           <div class="item-id-badge">ID: ${String(p.id).substring(0, 4)}</div>
        </div>
        <div class="inventory-item-body">
          <div class="inventory-stat">
            <span class="stat-label">Precio</span>
            <span class="stat-value">$${precioDisp}</span>
          </div>
          <div class="inventory-stat">
            <span class="stat-label">Stock</span>
            <span class="stat-value ${stockStatus}">${p.stock || 0}</span>
          </div>
          ${
            p.descripcion
              ? `<div class="inventory-stat" style="grid-column: 1/-1;">
            <span class="stat-label">Descripción</span>
            <span class="stat-value" style="font-size:0.9rem; font-weight:500;">${p.descripcion}</span>
          </div>`
              : ''
          }
        </div>
        <div class="inventory-actions-modern">
           <button class="inv-btn-action" onclick="app.editarDescripcionPrompt('${p.id}', '${(p.descripcion || '').replace(/'/g, '&apos;')}')" title="Editar Descripción">
             <i data-lucide="edit-2" style="width: 16px;"></i>
             <span>Desc</span>
           </button>
           <button class="inv-btn-action" onclick="app.editarStockPrompt('${p.id}', ${p.stock})" title="Ajustar Stock">
             <i data-lucide="plus-circle" style="width: 16px;"></i>
             <span>Stock</span>
           </button>
           <button class="inv-btn-action" onclick="app.editarPrecioPrompt('${p.id}', ${p.precio})" title="Cambiar Precio">
             <i data-lucide="dollar-sign" style="width: 16px;"></i>
             <span>Precio</span>
           </button>
           <button class="inv-btn-action" onclick="app.editarImagenProducto('${p.id}')" title="Cambiar Foto" style="flex: 0.8;">
             <i data-lucide="image" style="width: 16px;"></i>
             <span>Foto</span>
           </button>
           <button class="inv-btn-action btn-danger-icon" style="flex: 0.4;" onclick="app.eliminarItem('${p.id}')">
             <i data-lucide="trash-2" style="width: 16px;"></i>
           </button>
        </div>
      `;
      container.appendChild(item);
    });
    lucide.createIcons();
  },

  async editarStockPrompt(id, stockActual) {
    const nuevo = prompt(
      'Ajustar Stock (puedes usar +5 o -3 para sumar/restar):',
      stockActual,
    );
    if (nuevo === null) return;

    let stockFinal = stockActual;
    if (nuevo.startsWith('+')) {
      stockFinal += parseInt(nuevo.substring(1)) || 0;
    } else if (nuevo.startsWith('-')) {
      stockFinal -= parseInt(nuevo.substring(1)) || 0;
    } else {
      stockFinal = parseInt(nuevo) || 0;
    }

    if (stockFinal < 0) stockFinal = 0;
    await this.actualizarProductoCampo(id, 'stock', stockFinal);
  },

  async editarPrecioPrompt(id, precioActual) {
    const nuevo = prompt('Nuevo Precio:', precioActual);
    if (nuevo === null) return;
    const precioFinal = this.parseMonto(nuevo);
    if (isNaN(precioFinal)) return alert('Precio inválido');
    await this.actualizarProductoCampo(id, 'precio', precioFinal);
  },

  async editarDescripcionPrompt(id, descActual) {
    const nuevo = prompt('Nueva Descripción:', descActual);
    if (nuevo === null) return;
    await this.actualizarProductoCampo(id, 'descripcion', nuevo);
  },

  editarImagenProducto(id) {
    const prod = this.productos.find((p) => String(p.id) === String(id));
    if (!prod) return;

    // Crear overlay flotante con el picker
    let overlay = document.getElementById('_img-edit-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '_img-edit-overlay';
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(10,35,100,0.55);
        backdrop-filter:blur(4px); z-index:9999;
        display:flex; align-items:flex-end; justify-content:center;`;
      document.body.appendChild(overlay);
    }

    const banco = this.IMAGE_BANK[prod.categoria] || [];
    const opciones = [...banco, { src: '', label: 'Sin foto' }];

    overlay.innerHTML = `
      <div style="
        background:#fff; width:100%; max-width:560px;
        border-top:4px solid #f5c518; border-radius:14px 14px 0 0;
        padding:20px; max-height:70vh; overflow-y:auto;
        animation: slideUp 0.3s ease;
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <strong style="font-family:'Sniglet',cursive; font-size:1.1rem; color:#0d47a1;">
            Cambiar foto – ${prod.nombre}
          </strong>
          <button onclick="document.getElementById('_img-edit-overlay').remove()"
                  style="background:#f1f5f9; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer; font-size:1rem;">✕</button>
        </div>

        ${
          banco.length === 0
            ? `
          <p style="color:#94a3b8; font-size:0.85rem; padding:16px; background:#f8fafc; border-radius:10px; margin-bottom:14px;">
            No hay imágenes en el banco para <strong>${prod.categoria}</strong>.<br>
            Agrega fotos a <code>img/</code> y regístralas en <code>IMAGE_BANK</code> dentro de <code>app.js</code>.
          </p>`
            : ''
        }

        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:16px;">
          ${opciones
            .map((img) => {
              const isSel = (prod.imagen || '') === img.src;
              return `
              <div onclick="app._aplicarImagenProducto('${id}', '${img.src}', this)"
                   style="
                     cursor:pointer; border:3px solid ${isSel ? '#0d47a1' : '#e2e8f0'};
                     border-radius:10px; padding:8px; background:${isSel ? '#eef4ff' : '#fff'};
                     display:flex; flex-direction:column; align-items:center; gap:4px;
                     width:90px; transition:all 0.15s;
                   ">
                ${
                  img.src
                    ? `<img src="${img.src}" style="width:64px;height:64px;object-fit:contain;border-radius:6px;">`
                    : `<div style="width:64px;height:64px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;">📷</div>`
                }
                <span style="font-size:0.65rem;font-weight:700;color:#64748b;text-align:center;line-height:1.2;">${img.label}</span>
                ${isSel ? '<span style="font-size:0.6rem;background:#0d47a1;color:#fff;padding:1px 6px;border-radius:99px;">✓ actual</span>' : ''}
              </div>`;
            })
            .join('')}
        </div>
      </div>`;

    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  },

  async _aplicarImagenProducto(id, src, el) {
    // Destacar la opción elegida visualmente
    const cont = el.parentElement;
    cont.querySelectorAll('div[onclick]').forEach((d) => {
      d.style.borderColor = '#e2e8f0';
      d.style.background = '#fff';
    });
    el.style.borderColor = src ? '#0d47a1' : '#f5c518';
    el.style.background = src ? '#eef4ff' : '#fffdf0';

    await this.actualizarProductoCampo(id, 'imagen', src);
    document.getElementById('_img-edit-overlay')?.remove();
    this.notificar(src ? '🖼 Foto actualizada' : 'Foto eliminada del producto');
  },

  async actualizarProductoCampo(id, campo, val) {
    try {
      const menuRef = this.db
        .collection('negocios')
        .doc(this.negocioId)
        .collection('menu')
        .doc('actual');

      // Obtener copia fresca del servidor para evitar pérdida de datos (ej. nombre)
      const doc = await menuRef.get();
      if (!doc.exists) return;

      let productos = doc.data().productos || [];
      const pIdx = productos.findIndex((p) => p.id === id);
      if (pIdx === -1) return;

      // Actualizar solo el campo deseado
      productos[pIdx][campo] = val;

      await menuRef.update({ productos });
      this.notificar('Producto actualizado');
      // No forzamos renderInventoryList aquí porque el snapshot lo hará
    } catch (e) {
      console.error(e);
      alert('Error al actualizar: ' + e);
    }
  },

  async eliminarItem(id) {
    if (!confirm('¿Seguro que desea eliminar este producto?')) return;
    try {
      this.productos = this.productos.filter(
        (p) => String(p.id) !== String(id),
      );
      const menuRef = this.db
        .collection('negocios')
        .doc(this.negocioId)
        .collection('menu')
        .doc('actual');
      await menuRef.update({ productos: this.productos });
      this.notificar('Producto eliminado');
      this.selectInventoryCat(this.currentInvCat);
    } catch (e) {
      alert('Error: ' + e);
    }
  },

  // --- GESTIÓN DE INVENTARIO CENTRALIZADA ---

  mostrarFormularioNuevoProducto() {
    document.getElementById('inventory-list-view-main').style.display = 'none';
    document.getElementById('inventory-form-container-main').style.display =
      'block';
    // Limpiar campos
    [
      'inv-prod-name',
      'inv-prod-price',
      'inv-prod-stock',
      'inv-prod-desc',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('inv-prod-imagen').value = '';
    // Poblar el selector visual de imágenes filtrado por categoría actual
    this._renderImgPicker(this.currentInvCat || 'hamburguesas', null);
    lucide.createIcons();
  },

  // Renderiza solo selector de carga de imagen (sin previsualizaciones predefinidas)
  _renderImgPicker(cat, selectedSrc) {
    const grid = document.getElementById('img-picker-grid');
    if (!grid) return;

    let html = '';
    const sinFoto = !selectedSrc || selectedSrc === '';

    // Si ya hay una imagen seleccionada, mostrarla
    if (selectedSrc && selectedSrc !== '') {
      html = `
        <div style="
          position: relative;
          border: 3px solid #10b981;
          border-radius: 10px;
          padding: 6px;
          background: #ecfdf5;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          width: 90px;
        ">
          <img src="${selectedSrc}" alt="Foto cargada"
               style="width:64px; height:64px; object-fit:cover; border-radius:6px;">
          <span style="display:flex; align-items:center; gap:4px; font-size:0.6rem; background:#10b981; color:#fff; padding:2px 6px; border-radius:99px;">
            <i data-lucide="check-circle" style="width:14px; height:14px; vertical-align:middle;"></i> Guardada
          </span>
        </div>`;
    }

    // Botón de carga
    html += `
      <div style="
        cursor:pointer;
        border: 3px dashed #64b5f6;
        border-radius: 10px;
        padding: 6px;
        background: #f0f7ff;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 90px;
        transition: all 0.2s;
      " class="img-upload-label">
        <div style="width:64px; height:64px; border-radius:6px; display:flex; align-items:center; justify-content:center;">
          <i data-lucide="upload-cloud" style="width:32px; height:32px; color:#1e88e5;"></i>
        </div>
        <span style="font-size:0.65rem; font-weight:700; color:#1e88e5; text-align:center; line-height:1.2;">Cargar Foto</span>
        <input 
          type="file" 
          accept="image/*" 
          style="display:none;" 
          class="img-upload-input">
      </div>`;

    // Opción "Sin foto"
    html += `
      <div
        class="img-picker-option${sinFoto ? ' selected' : ''}"
        onclick="app._seleccionarImagen('', this)"
        title="Sin foto"
        style="
          cursor:pointer;
          border: 3px solid ${sinFoto ? '#f5c518' : '#e2e8f0'};
          border-radius: 10px;
          padding: 6px;
          background: ${sinFoto ? '#fffdf0' : '#fff'};
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          width: 90px;
          transition: all 0.15s;
        ">
        <div style="width:64px; height:64px; border-radius:6px; background:#f1f5f9; display:flex; align-items:center; justify-content:center;">
          <i data-lucide="image-off" style="width:28px; height:28px; color:#64748b;"></i>
        </div>
        <span style="font-size:0.65rem; font-weight:700; color:#64748b; text-align:center; line-height:1.2;">Sin foto</span>
        ${sinFoto ? '<span style="font-size:0.6rem; background:#f5c518; color:#0d47a1; padding:1px 6px; border-radius:99px;"><i data-lucide="check" style="width:12px; height:12px; vertical-align:middle;"></i></span>' : ''}
      </div>`;

    grid.innerHTML = html;

    // Usar event delegation para evitar listeners duplicados
    const fileInput = grid.querySelector('.img-upload-input');
    const label = grid.querySelector('.img-upload-label');

    // Quitar todos los listeners antiguos reemplazando cloneNode
    const newLabel = label.cloneNode(true);
    label.parentNode.replaceChild(newLabel, label);

    const newFileInput = grid.querySelector('.img-upload-input');
    const newLabelElement = grid.querySelector('.img-upload-label');

    // Agregar listeners solo una vez con los elementos nuevos
    if (newFileInput) {
      newFileInput.addEventListener('change', (e) =>
        this._handleImageUpload(e),
      );
    }

    if (newLabelElement) {
      newLabelElement.addEventListener('mouseover', function () {
        this.style.borderColor = '#1e88e5';
        this.style.background = '#e3f2fd';
      });
      newLabelElement.addEventListener('mouseout', function () {
        this.style.borderColor = '#64b5f6';
        this.style.background = '#f0f7ff';
      });
      newLabelElement.addEventListener('click', function (e) {
        e.stopPropagation();
        newFileInput.click();
      });
    }
  },

  _seleccionarImagen(src, el) {
    document.getElementById('inv-prod-imagen').value = src;
    // Re-renderizar para actualizar visual
    this._renderImgPicker(this.currentInvCat || 'hamburguesas', src);
  },

  // Maneja la carga de imágenes a Firebase Storage y las guarda permanentemente
  async _handleImageUpload(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;

    // Validar tamaño (máx 5MB)
    if (archivo.size > 5 * 1024 * 1024) {
      alert('La imagen debe ser menor a 5MB');
      return;
    }

    try {
      this.notificar('📤 Subiendo foto...');

      // Generar nombre único para la imagen
      const timestamp = Date.now();
      const nombreArchivo = `producto_${timestamp}_${archivo.name}`;
      const rutaStorage = `productos/${this.negocioId}/${nombreArchivo}`;

      // Subir a Firebase Storage
      const storage = firebase.storage();
      const ref = storage.ref(rutaStorage);
      const snapshot = await ref.put(archivo);

      // Obtener URL de descarga persistente
      const urlImagen = await ref.getDownloadURL();

      // Guardar URL en el campo oculto
      document.getElementById('inv-prod-imagen').value = urlImagen;

      // Re-renderizar el picker para mostrar la nueva imagen guardada
      this._renderImgPicker(this.currentInvCat || 'hamburguesas', urlImagen);

      this.notificar('✅ Foto guardada y lista para usar');
    } catch (e) {
      console.error('Error al subir imagen:', e);
      this.notificar('❌ Error: ' + e.message);
    }
  },

  ocultarFormularioNuevoProducto() {
    document.getElementById('inventory-list-view-main').style.display = 'block';
    document.getElementById('inventory-form-container-main').style.display =
      'none';
  },

  volverACategoriasInv() {
    // En la nueva estructura, v-inventario ya muestra las categorías directamente
    this.ocultarFormularioNuevoProducto();
    if (this.currentInvCat) this.selectInventoryCat(this.currentInvCat);
    else this.selectInventoryCat('hamburguesas');
    lucide.createIcons();
  },

  async guardarNuevoProducto() {
    const name = document.getElementById('inv-prod-name').value.trim();
    const price = document.getElementById('inv-prod-price').value;
    const stock = document.getElementById('inv-prod-stock').value;
    const desc = document.getElementById('inv-prod-desc').value.trim();
    const imagen = document.getElementById('inv-prod-imagen')?.value || '';

    if (!name || !price) return alert('Nombre y precio obligatorios');

    const nuevo = {
      id: Date.now().toString(),
      nombre: name,
      precio: this.parseMonto(price),
      stock: parseInt(stock) || 0,
      descripcion: desc || '',
      categoria: this.currentInvCat || 'hamburguesas',
      imagen: imagen,
    };

    try {
      const menuRef = this.db
        .collection('negocios')
        .doc(this.negocioId)
        .collection('menu')
        .doc('actual');
      const doc = await menuRef.get();
      let productos = [];
      if (doc.exists) productos = doc.data().productos || [];

      productos.push(nuevo);
      await menuRef.update({ productos });

      this.notificar('Producto agregado con éxito');
      this.ocultarFormularioNuevoProducto();
      this.selectInventoryCat(this.currentInvCat);

      document.getElementById('inv-prod-name').value = '';
      document.getElementById('inv-prod-price').value = '';
      document.getElementById('inv-prod-stock').value = '';
      document.getElementById('inv-prod-desc').value = '';
      if (document.getElementById('inv-prod-imagen'))
        document.getElementById('inv-prod-imagen').value = '';
    } catch (e) {
      alert('Error: ' + e);
    }
  },

  logout() {
    localStorage.removeItem('griviti_nombre');
    localStorage.removeItem('griviti_modo');
    location.reload();
  },

  cerrarMesa() {
    document.getElementById('modalMesa').style.display = 'none';
    // reset metodo pago
    const metodoEl = document.getElementById('metodoPago');
    if (metodoEl) metodoEl.value = '';

    // limpiar campos de pago (efectivo)
    const cr = document.getElementById('cashReceived');
    if (cr) cr.value = '0';
    const changeEl = document.getElementById('changeDisplay');
    if (changeEl) changeEl.textContent = 'Cambio: $0';

    // limpiar campos de transferencia
    const tr = document.getElementById('transferRef');
    if (tr) tr.value = '';
    const trAmt = document.getElementById('transferAmount');
    if (trAmt) trAmt.value = '0';

    // limpiar campos mixtos
    const mTrAmt = document.getElementById('mixedTransferAmount');
    if (mTrAmt) mTrAmt.value = '0';
    const mCash = document.getElementById('mixedCashReceived');
    if (mCash) mCash.value = '0';
    const mRef = document.getElementById('mixedTransferRef');
    if (mRef) mRef.value = '';
    const mChangeEl = document.getElementById('mixedChangeDisplay');
    if (mChangeEl) mChangeEl.textContent = 'Cambio: $0';

    // ocultar inputs
    const efBox = document.getElementById('efectivoBox');
    const trBox = document.getElementById('transferBox');
    const mixedBox = document.getElementById('mixedBox');
    if (efBox) efBox.style.display = 'none';
    if (trBox) trBox.style.display = 'none';
    if (mixedBox) mixedBox.style.display = 'none';
  },

  async publicarMenuWeb() {
    if (
      !confirm(
        '¿Deseas publicar el menú actual a la web? Esto actualizará lo que ven tus clientes.',
      )
    )
      return;

    this.notificar('⏳ Generando menú...');

    try {
      // 1. Agrupar productos por categoría
      const menuPublico = {};
      const categorias = [
        'hamburguesas',
        'perros',
        'salchipapas',
        'bebidas',
        'otros',
      ];

      categorias.forEach((cat) => {
        menuPublico[cat] = this.productos
          .filter((p) => {
            const pCat = String(p.categoria || 'hamburguesas').toLowerCase();
            if (cat === 'otros') {
              return !['hamburguesas', 'perros', 'salchipapas', 'bebidas'].some(
                (c) => pCat.includes(c),
              );
            }
            return pCat.includes(cat.substring(0, 5)); // Match parcial
          })
          .map((p) => ({
            id: p.id,
            nombre: p.nombre,
            precio: p.precio,
            descripcion: p.descripcion || 'Deliciosa opción de nuestra casa.',
            imagen: p.imagen || '',
            tags: p.tags || ['NUEVO'],
          }));
      });

      // 2. Convertir a JSON
      const jsonContent = JSON.stringify(menuPublico, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });

      // 3. Subir a Firebase Storage
      const storageRef = firebase.storage().ref('public/menu.json');
      await storageRef.put(blob);

      this.notificar('✅ ¡Menú publicado con éxito!');
      console.log('Menú publicado en Storage: public/menu.json');
    } catch (e) {
      console.error('Error al publicar:', e);
      alert('Error al publicar el menú: ' + e.message);
    }
  },

  async togglePedidosWeb() {
    const el = document.getElementById('togglePedidosWeb');
    if (!el) return;

    const estaActivo = el.classList.contains('activo');
    const nuevoEstado = !estaActivo;

    this.notificar(
      nuevoEstado ? '🚀 Activando Pedidos Web' : '⏳ Pausando Pedidos Web',
    );

    try {
      // Usar set con merge para crear o actualizar el documento
      await this.db.collection('negocios').doc(this.negocioId).set(
        {
          pedidosWebActivos: nuevoEstado,
        },
        { merge: true },
      );
      this.actualizarVisualToggle(nuevoEstado);
      this.notificar(
        nuevoEstado ? '✅ Pedidos Web Activados' : '✅ Pedidos Web Pausados',
      );
    } catch (e) {
      console.error('Error al cambiar estado de pedidos web:', e);
      this.notificar('❌ Error: ' + e.message);
    }
  },

  actualizarVisualToggle(activo) {
    const el = document.getElementById('togglePedidosWeb');
    if (!el) return;

    if (activo) {
      el.classList.remove('pausado');
      el.classList.add('activo');
      el.querySelector('span').innerText = 'Pedidos Web: Activos';
      el.style.background =
        'linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))';
      el.style.color = '#22c55e';
      el.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.3)';
    } else {
      el.classList.remove('activo');
      el.classList.add('pausado');
      el.querySelector('span').innerText = 'Pedidos Web: Pausados';
      el.style.background =
        'linear-gradient(135deg, rgba(220, 38, 38, 0.15), rgba(220, 38, 38, 0.05))';
      el.style.color = '#dc2626';
      el.style.boxShadow = '0 0 20px rgba(220, 38, 38, 0.1)';
    }
  },
};

window.onload = () => {
  app.init();
  // Controlar visibilidad del dashboard al cambiar tamaño de pantalla
  window.addEventListener('resize', () => {
    if (document.getElementById('v-reportetotal').style.display !== 'none') {
      app.mostrarDashboardSegunModo();
    }
  });
};
