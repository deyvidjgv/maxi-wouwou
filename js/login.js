/**
 * login.js - Manejo de autenticación y redirección por rol
 */

// Inicialización ahora centralizada en firebase-config.js
const auth = firebase.auth();
const db = firebase.firestore();

const btnLogin = document.getElementById('btnLogin');
const emailInput = document.getElementById('loginEmail');
const passInput = document.getElementById('loginPassword');
const errorMsg = document.getElementById('loginError');

// Escuchar evento de click en el botón de login
if (btnLogin) {
  btnLogin.addEventListener('click', async () => {
    const email = emailInput.value;
    const password = passInput.value;

    if (!email || !password) {
      mostrarError('Por favor ingrese correo y contraseña.');
      return;
    }

    setLoading(true);

    try {
      // 1. Autenticar con Firebase Authentication
      const userCredential = await auth.signInWithEmailAndPassword(
        email,
        password,
      );
      const user = userCredential.user;

      // 2. Consultar el rol en Firestore
      const userDoc = await db.collection('users').doc(user.uid).get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        const rol = userData.rol;

        // 3. Redirigir según el rol
        if (rol === 'admin') {
          window.location.href = 'admin.html';
        } else if (rol === 'mesero') {
          window.location.href = 'mesero.html';
        } else {
          mostrarError('Su usuario no tiene un rol asignado válido.');
          auth.signOut();
        }
      } else {
        mostrarError('No se encontró información de perfil para este usuario.');
        auth.signOut();
      }
    } catch (error) {
      console.error('Error en login:', error);
      let mensaje = 'Error de conexión o de servidor.';

      switch (error.code) {
        case 'auth/user-not-found':
          mensaje = 'El correo electrónico no está registrado.';
          break;
        case 'auth/wrong-password':
          mensaje = 'La contraseña es incorrecta.';
          break;
        case 'auth/invalid-email':
          mensaje = 'El formato del correo es inválido.';
          break;
        case 'auth/user-disabled':
          mensaje = 'Este usuario ha sido deshabilitado.';
          break;
        default:
          mensaje = `Error (${error.code || 'desconocido'}): ${error.message}`;
      }

      mostrarError(mensaje);
    } finally {
      setLoading(false);
    }
  });
}

/**
 * Muestra un mensaje de error en la UI
 */
function mostrarError(mensaje) {
  errorMsg.innerText = mensaje;
  errorMsg.style.display = 'block';
}

/**
 * Controla el estado visual del botón durante la carga
 */
function setLoading(loading) {
  if (loading) {
    btnLogin.disabled = true;
    btnLogin.innerText = 'CARGANDO...';
    errorMsg.style.display = 'none';
  } else {
    btnLogin.disabled = false;
    btnLogin.innerText = 'ENTRAR';
  }
}

/**
 * Redirección automática si ya hay una sesión activa
 */
auth.onAuthStateChanged(async (user) => {
  if (user) {
    try {
      const userDoc = await db.collection('users').doc(user.uid).get();
      if (userDoc.exists) {
        const rol = userDoc.data().rol;
        if (
          rol === 'admin' &&
          !window.location.pathname.includes('admin.html')
        ) {
          window.location.href = 'admin.html';
        } else if (
          rol === 'mesero' &&
          !window.location.pathname.includes('mesero.html')
        ) {
          window.location.href = 'mesero.html';
        }
      }
    } catch (e) {
      console.error('Error al verificar sesión activa:', e);
      if (e.code === 'permission-denied') {
        mostrarError(
          'Error: No tienes permisos para leer tu perfil de usuario en Firestore. Revisa las reglas de seguridad.',
        );
      }
    }
  }
});
