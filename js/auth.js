// js/auth.js
import { auth, providerGoogle, db } from "./firebase.js";

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

export const TENANT_ID = "default";
export const ADMIN_EMAIL = "pedro.l.oldani@gmail.com";

/** iPhone/iPad/Android -> mejor redirect que popup */
function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/** Browsers embebidos (IG/FB/WhatsApp) suelen romper OAuth */
export function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|WhatsApp/i.test(ua);
}

/** Espera a que Auth tenga el usuario resuelto (o null) */
export function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export function onSession(cb) {
  return onAuthStateChanged(auth, cb);
}

/** Para mobile redirect: hay que consumir el resultado al cargar la página */
export async function handleRedirectResult() {
  try {
    await getRedirectResult(auth);
  } catch (e) {
    // No lo rompemos por esto; solo log
    console.warn("getRedirectResult error:", e);
  }
}

export async function loginGoogle() {
  // Si está dentro de un in-app browser, popup/redirect puede ser inestable
  // Igual intentamos; el mensaje lo podés mostrar en index.html si querés.
  if (isMobileDevice()) {
    await signInWithRedirect(auth, providerGoogle);
  } else {
    await signInWithPopup(auth, providerGoogle);
  }
}

export async function logout() {
  await signOut(auth);
}

export async function getMyProfile() {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) return null;

  const email = (user.email || "").toLowerCase();

  // Admin bootstrap por email
  if (email === ADMIN_EMAIL.toLowerCase()) {
    const ref = doc(db, "tenants", TENANT_ID, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(
        ref,
        {
          tenantId: TENANT_ID,
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || "",
          role: "admin",
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    return {
      tenantId: TENANT_ID,
      role: "admin",
      active: true,
      email: user.email,
      displayName: user.displayName,
      uid: user.uid,
    };
  }

  // Resto: perfil en Firestore
  const ref = doc(db, "tenants", TENANT_ID, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return {
      tenantId: TENANT_ID,
      role: "none",
      active: false,
      email: user.email,
      displayName: user.displayName,
      uid: user.uid,
    };
  }

  return snap.data();
}

/** Auto-registro "pendiente" (para que el admin lo apruebe después) */
export async function ensureUserRequestExists() {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) return;

  const ref = doc(db, "tenants", TENANT_ID, "user_requests", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  await setDoc(
    ref,
    {
      tenantId: TENANT_ID,
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Guard: requiere estar logueado y tener rol permitido */
export async function requireRole(allowedRoles = ["admin", "operator", "viewer"]) {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) {
    window.location.href = "../index.html";
    return null;
  }

  const profile = await getMyProfile();
  const ok = profile?.active && allowedRoles.includes(profile.role);

  if (!ok) {
    window.location.href = "../pages/no_access.html";
    return null;
  }

  return profile;
}
