const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
const { getAuth, signInAnonymously } = require('firebase/auth');

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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const NEGOCIO_ID = 'griviti_main';

async function checkMenu() {
  try {
    console.log('Signing in anonymously...');
    const userCred = await signInAnonymously(auth);
    console.log('Signed in as:', userCred.user.uid);

    const snap = await getDoc(doc(db, 'negocios', NEGOCIO_ID));
    if (snap.exists()) {
      console.log('Negocio settings:', JSON.stringify(snap.data(), null, 2));
    } else {
      console.log('Negocio doc not found.');
    }

    const menuSnap = await getDoc(
      doc(db, 'negocios', NEGOCIO_ID, 'menu', 'actual'),
    );
    if (menuSnap.exists()) {
      const data = menuSnap.data();
      console.log(
        '\nMenu exists. Products count:',
        data.productos ? data.productos.length : 0,
      );
      if (data.productos) {
        console.log('Categories present in DB:', [
          ...new Set(data.productos.map((p) => p.categoria)),
        ]);
        console.log(
          'Sample product categories:',
          data.productos
            .slice(0, 5)
            .map((p) => ({ nombre: p.nombre, cat: p.categoria })),
        );
      }
    } else {
      console.log("\nMenu 'actual' document not found!");
    }
  } catch (e) {
    console.error('Error details:', e);
  }
}

checkMenu();
