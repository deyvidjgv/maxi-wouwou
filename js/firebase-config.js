<<<<<<< HEAD
// Firebase Configuration - Compat Mode (para scripts tradicionales en HTML)
// DO NOT use import/export - Firebase SDK se carga desde CDN en index.html

const firebaseConfig = {
  apiKey: 'AIzaSyA9mNak-N_V0J2If2ikMNlgk4LqBIODaY0',
  authDomain: 'negocio-comidas-rapidas.firebaseapp.com',
  databaseURL: 'https://negocio-comidas-rapidas-default-rtdb.firebaseio.com',
  projectId: 'negocio-comidas-rapidas',
  storageBucket: 'negocio-comidas-rapidas.appspot.com',
  messagingSenderId: '612360590555',
  appId: '1:612360590555:web:4389d7967b6a54cce768fe',
  measurementId: 'G-HCH10V5SKD',
};

// Inicialización de Firebase (Compat Mode)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
=======
// Firebase Configuration - Compat Mode (para scripts tradicionales en HTML)
// DO NOT use import/export - Firebase SDK se carga desde CDN en index.html

const firebaseConfig = {
  apiKey: 'AIzaSyA9mNak-N_V0J2If2ikMNlgk4LqBIODaY0',
  authDomain: 'negocio-comidas-rapidas.firebaseapp.com',
  databaseURL: 'https://negocio-comidas-rapidas-default-rtdb.firebaseio.com',
  projectId: 'negocio-comidas-rapidas',
  storageBucket: 'negocio-comidas-rapidas.appspot.com',
  messagingSenderId: '612360590555',
  appId: '1:612360590555:web:4389d7967b6a54cce768fe',
  measurementId: 'G-HCH10V5SKD',
};

// Inicialización de Firebase (Compat Mode)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
>>>>>>> a3c41e4abcda6d5c2116f60e540cc99ee0c705bb
