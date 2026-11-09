// Firebase SDK, loaded from Google's CDN. Everything else imports Firebase through this file.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection,
  query, where, orderBy, limit, runTransaction, getDocs, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export { initializeApp, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  getFirestore, initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection,
  query, where, orderBy, limit, runTransaction, getDocs, serverTimestamp };
